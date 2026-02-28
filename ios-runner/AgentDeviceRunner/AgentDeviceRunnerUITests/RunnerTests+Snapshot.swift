import XCTest

extension RunnerTests {
  // MARK: - Snapshot Entry

  func elementTypeName(_ type: XCUIElement.ElementType) -> String {
    switch type {
    case .application: return "Application"
    case .window: return "Window"
    case .button: return "Button"
    case .cell: return "Cell"
    case .staticText: return "StaticText"
    case .textField: return "TextField"
    case .textView: return "TextView"
    case .secureTextField: return "SecureTextField"
    case .switch: return "Switch"
    case .slider: return "Slider"
    case .link: return "Link"
    case .image: return "Image"
    case .navigationBar: return "NavigationBar"
    case .tabBar: return "TabBar"
    case .collectionView: return "CollectionView"
    case .table: return "Table"
    case .scrollView: return "ScrollView"
    case .searchField: return "SearchField"
    case .segmentedControl: return "SegmentedControl"
    case .stepper: return "Stepper"
    case .picker: return "Picker"
    case .checkBox: return "CheckBox"
    case .menuItem: return "MenuItem"
    case .other: return "Other"
    default:
      switch type.rawValue {
      case 19:
        return "Keyboard"
      case 20:
        return "Key"
      case 24:
        return "SearchField"
      default:
        return "Element(\(type.rawValue))"
      }
    }
  }

  func snapshotFast(app: XCUIApplication, options: SnapshotOptions) -> DataPayload {
    if let blocking = blockingSystemAlertSnapshot() {
      return blocking
    }

    var nodes: [SnapshotNode] = []
    var truncated = false
    let maxDepth = options.depth ?? Int.max
    let viewport = app.frame
    let queryRoot = options.scope.flatMap { findScopeElement(app: app, scope: $0) } ?? app

    let rootSnapshot: XCUIElementSnapshot
    do {
      rootSnapshot = try queryRoot.snapshot()
    } catch {
      return DataPayload(nodes: nodes, truncated: truncated)
    }

    let (flatSnapshots, snapshotRanges) = flattenedSnapshots(rootSnapshot)
    let rootLaterNodes = laterSnapshots(
      for: rootSnapshot,
      in: flatSnapshots,
      ranges: snapshotRanges
    )
    let rootLabel = aggregatedLabel(for: rootSnapshot) ?? rootSnapshot.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let rootIdentifier = rootSnapshot.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    let rootValue = snapshotValueText(rootSnapshot)
    let rootHittable = computedSnapshotHittable(rootSnapshot, viewport: viewport, laterNodes: rootLaterNodes)
    nodes.append(
      SnapshotNode(
        index: 0,
        type: elementTypeName(rootSnapshot.elementType),
        label: rootLabel.isEmpty ? nil : rootLabel,
        identifier: rootIdentifier.isEmpty ? nil : rootIdentifier,
        value: rootValue,
        rect: SnapshotRect(
          x: Double(rootSnapshot.frame.origin.x),
          y: Double(rootSnapshot.frame.origin.y),
          width: Double(rootSnapshot.frame.size.width),
          height: Double(rootSnapshot.frame.size.height),
        ),
        enabled: rootSnapshot.isEnabled,
        hittable: rootHittable,
        depth: 0,
      )
    )

    var seen = Set<String>()
    var stack: [(XCUIElementSnapshot, Int, Int)] = rootSnapshot.children.map { ($0, 1, 1) }

    while let (snapshot, depth, visibleDepth) = stack.popLast() {
      if nodes.count >= fastSnapshotLimit {
        truncated = true
        break
      }
      if let limit = options.depth, depth > limit { continue }

      let label = aggregatedLabel(for: snapshot) ?? snapshot.label.trimmingCharacters(in: .whitespacesAndNewlines)
      let identifier = snapshot.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
      let valueText = snapshotValueText(snapshot)
      let laterNodes = laterSnapshots(
        for: snapshot,
        in: flatSnapshots,
        ranges: snapshotRanges
      )
      let hittable = computedSnapshotHittable(snapshot, viewport: viewport, laterNodes: laterNodes)
      let hasContent = !label.isEmpty || !identifier.isEmpty || (valueText != nil)
      if !isVisibleInViewport(snapshot.frame, viewport) && !hasContent {
        continue
      }

      let include = shouldInclude(
        snapshot: snapshot,
        label: label,
        identifier: identifier,
        valueText: valueText,
        options: options,
        hittable: hittable
      )

      let key = "\(snapshot.elementType)-\(label)-\(identifier)-\(snapshot.frame.origin.x)-\(snapshot.frame.origin.y)"
      let isDuplicate = seen.contains(key)
      if !isDuplicate {
        seen.insert(key)
      }

      if depth < maxDepth {
        let nextVisibleDepth = include && !isDuplicate ? visibleDepth + 1 : visibleDepth
        for child in snapshot.children.reversed() {
          stack.append((child, depth + 1, nextVisibleDepth))
        }
      }

      if !include || isDuplicate { continue }

      nodes.append(
        SnapshotNode(
          index: nodes.count,
          type: elementTypeName(snapshot.elementType),
          label: label.isEmpty ? nil : label,
          identifier: identifier.isEmpty ? nil : identifier,
          value: valueText,
          rect: SnapshotRect(
            x: Double(snapshot.frame.origin.x),
            y: Double(snapshot.frame.origin.y),
            width: Double(snapshot.frame.size.width),
            height: Double(snapshot.frame.size.height),
          ),
          enabled: snapshot.isEnabled,
          hittable: hittable,
          depth: min(maxDepth, visibleDepth),
        )
      )

    }

    return DataPayload(nodes: nodes, truncated: truncated)
  }

  func snapshotRaw(app: XCUIApplication, options: SnapshotOptions) -> DataPayload {
    if let blocking = blockingSystemAlertSnapshot() {
      return blocking
    }

    let queryRoot = options.scope.flatMap { findScopeElement(app: app, scope: $0) } ?? app
    var nodes: [SnapshotNode] = []
    var truncated = false
    let viewport = app.frame

    let rootSnapshot: XCUIElementSnapshot
    do {
      rootSnapshot = try queryRoot.snapshot()
    } catch {
      return DataPayload(nodes: nodes, truncated: truncated)
    }

    let (flatSnapshots, snapshotRanges) = flattenedSnapshots(rootSnapshot)

    func walk(_ snapshot: XCUIElementSnapshot, depth: Int) {
      if nodes.count >= maxSnapshotElements {
        truncated = true
        return
      }
      if let limit = options.depth, depth > limit { return }
      if !isVisibleInViewport(snapshot.frame, viewport) { return }

      let label = aggregatedLabel(for: snapshot) ?? snapshot.label.trimmingCharacters(in: .whitespacesAndNewlines)
      let identifier = snapshot.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
      let valueText = snapshotValueText(snapshot)
      let laterNodes = laterSnapshots(
        for: snapshot,
        in: flatSnapshots,
        ranges: snapshotRanges
      )
      let hittable = computedSnapshotHittable(snapshot, viewport: viewport, laterNodes: laterNodes)
      if shouldInclude(
        snapshot: snapshot,
        label: label,
        identifier: identifier,
        valueText: valueText,
        options: options,
        hittable: hittable
      ) {
        nodes.append(
          SnapshotNode(
            index: nodes.count,
            type: elementTypeName(snapshot.elementType),
            label: label.isEmpty ? nil : label,
            identifier: identifier.isEmpty ? nil : identifier,
            value: valueText,
            rect: snapshotRect(from: snapshot.frame),
            enabled: snapshot.isEnabled,
            hittable: hittable,
            depth: depth,
          )
        )
      }

      let children = snapshot.children
      for child in children {
        walk(child, depth: depth + 1)
        if truncated { return }
      }
    }

    walk(rootSnapshot, depth: 0)
    return DataPayload(nodes: nodes, truncated: truncated)
  }

  func snapshotRect(from frame: CGRect) -> SnapshotRect {
    return SnapshotRect(
      x: Double(frame.origin.x),
      y: Double(frame.origin.y),
      width: Double(frame.size.width),
      height: Double(frame.size.height)
    )
  }

  // MARK: - Snapshot Filtering

  private func shouldInclude(
    snapshot: XCUIElementSnapshot,
    label: String,
    identifier: String,
    valueText: String?,
    options: SnapshotOptions,
    hittable: Bool
  ) -> Bool {
    let type = snapshot.elementType
    let hasContent = !label.isEmpty || !identifier.isEmpty || (valueText != nil)
    if options.compact && type == .other && !hasContent && !hittable {
      if snapshot.children.count <= 1 { return false }
    }
    if options.interactiveOnly {
      if interactiveTypes.contains(type) { return true }
      if hittable && type != .other { return true }
      if hasContent { return true }
      return false
    }
    if options.compact {
      return hasContent || hittable
    }
    return true
  }

  private func computedSnapshotHittable(
    _ snapshot: XCUIElementSnapshot,
    viewport: CGRect,
    laterNodes: ArraySlice<XCUIElementSnapshot>
  ) -> Bool {
    guard snapshot.isEnabled else { return false }
    let frame = snapshot.frame
    if frame.isNull || frame.isEmpty { return false }
    let center = CGPoint(x: frame.midX, y: frame.midY)
    if !viewport.contains(center) { return false }
    for node in laterNodes {
      if !isOccludingType(node.elementType) { continue }
      let nodeFrame = node.frame
      if nodeFrame.isNull || nodeFrame.isEmpty { continue }
      if nodeFrame.contains(center) { return false }
    }
    return true
  }

  private func isOccludingType(_ type: XCUIElement.ElementType) -> Bool {
    switch type {
    case .application, .window:
      return false
    default:
      return true
    }
  }

  private func flattenedSnapshots(
    _ root: XCUIElementSnapshot
  ) -> ([XCUIElementSnapshot], [ObjectIdentifier: (Int, Int)]) {
    var ordered: [XCUIElementSnapshot] = []
    var ranges: [ObjectIdentifier: (Int, Int)] = [:]

    @discardableResult
    func visit(_ snapshot: XCUIElementSnapshot) -> Int {
      let start = ordered.count
      ordered.append(snapshot)
      var end = start
      for child in snapshot.children {
        end = max(end, visit(child))
      }
      ranges[ObjectIdentifier(snapshot)] = (start, end)
      return end
    }

    _ = visit(root)
    return (ordered, ranges)
  }

  private func laterSnapshots(
    for snapshot: XCUIElementSnapshot,
    in ordered: [XCUIElementSnapshot],
    ranges: [ObjectIdentifier: (Int, Int)]
  ) -> ArraySlice<XCUIElementSnapshot> {
    guard let (_, subtreeEnd) = ranges[ObjectIdentifier(snapshot)] else {
      return ordered.suffix(from: ordered.count)
    }
    let nextIndex = subtreeEnd + 1
    if nextIndex >= ordered.count {
      return ordered.suffix(from: ordered.count)
    }
    return ordered.suffix(from: nextIndex)
  }

  private func snapshotValueText(_ snapshot: XCUIElementSnapshot) -> String? {
    guard let value = snapshot.value else { return nil }
    let text = String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }

  private func aggregatedLabel(for snapshot: XCUIElementSnapshot, depth: Int = 0) -> String? {
    if depth > 4 { return nil }
    let text = snapshot.label.trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.isEmpty { return text }
    if let valueText = snapshotValueText(snapshot) { return valueText }
    for child in snapshot.children {
      if let childLabel = aggregatedLabel(for: child, depth: depth + 1) {
        return childLabel
      }
    }
    return nil
  }

  private func isVisibleInViewport(_ rect: CGRect, _ viewport: CGRect) -> Bool {
    if rect.isNull || rect.isEmpty { return false }
    return rect.intersects(viewport)
  }
}
