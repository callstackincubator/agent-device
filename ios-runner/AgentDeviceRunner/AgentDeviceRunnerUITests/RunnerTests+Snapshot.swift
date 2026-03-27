import XCTest

extension RunnerTests {
  private static let collapsedTabCandidateTypes: Set<XCUIElement.ElementType> = [
    .button,
    .link,
    .menuItem,
    .other,
    .staticText
  ]

  private struct SnapshotTraversalContext {
    let queryRoot: XCUIElement
    let rootSnapshot: XCUIElementSnapshot
    let viewport: CGRect
    let flatSnapshots: [XCUIElementSnapshot]
    let snapshotRanges: [ObjectIdentifier: (Int, Int)]
    let maxDepth: Int
  }

  private struct SnapshotEvaluation {
    let label: String
    let identifier: String
    let valueText: String?
    let hittable: Bool
    let visible: Bool
  }

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

    guard let context = makeSnapshotTraversalContext(app: app, options: options) else {
      return DataPayload(nodes: [], truncated: false)
    }

    var cachedDescendantElements: [XCUIElement]?
    func collapsedTabDescendants() -> [XCUIElement] {
      if let cachedDescendantElements {
        return cachedDescendantElements
      }
      let fetched = safeSnapshotElementsQuery {
        context.queryRoot.descendants(matching: .any).allElementsBoundByIndex
      }
      cachedDescendantElements = fetched
      return fetched
    }

    var nodes: [SnapshotNode] = []
    var truncated = false
    let rootEvaluation = evaluateSnapshot(context.rootSnapshot, in: context)
    nodes.append(
      makeSnapshotNode(snapshot: context.rootSnapshot, evaluation: rootEvaluation, depth: 0, index: 0)
    )
    if context.maxDepth > 0 {
      let didTruncateFallback = appendCollapsedTabFallbackNodes(
        to: &nodes,
        containerSnapshot: context.rootSnapshot,
        resolveElements: collapsedTabDescendants,
        depth: 1,
        nodeLimit: fastSnapshotLimit
      )
      truncated = truncated || didTruncateFallback
    }

    var seen = Set<String>()
    var stack: [(XCUIElementSnapshot, Int, Int)] = context.rootSnapshot.children.map { ($0, 1, 1) }

    while let (snapshot, depth, visibleDepth) = stack.popLast() {
      if nodes.count >= fastSnapshotLimit {
        truncated = true
        break
      }
      if let limit = options.depth, depth > limit { continue }

      let evaluation = evaluateSnapshot(snapshot, in: context)
      let include = shouldInclude(
        snapshot: snapshot,
        label: evaluation.label,
        identifier: evaluation.identifier,
        valueText: evaluation.valueText,
        options: options,
        hittable: evaluation.hittable,
        visible: evaluation.visible
      )

      let key = "\(snapshot.elementType)-\(evaluation.label)-\(evaluation.identifier)-\(snapshot.frame.origin.x)-\(snapshot.frame.origin.y)"
      let isDuplicate = seen.contains(key)
      if !isDuplicate {
        seen.insert(key)
      }

      if depth < context.maxDepth {
        let nextVisibleDepth = include && !isDuplicate ? visibleDepth + 1 : visibleDepth
        for child in snapshot.children.reversed() {
          stack.append((child, depth + 1, nextVisibleDepth))
        }
      }

      if !include || isDuplicate { continue }

      nodes.append(
        makeSnapshotNode(
          snapshot: snapshot,
          evaluation: evaluation,
          depth: min(context.maxDepth, visibleDepth),
          index: nodes.count
        )
      )
      if visibleDepth < context.maxDepth {
        let didTruncateFallback = appendCollapsedTabFallbackNodes(
          to: &nodes,
          containerSnapshot: snapshot,
          resolveElements: collapsedTabDescendants,
          depth: visibleDepth + 1,
          nodeLimit: fastSnapshotLimit
        )
        truncated = truncated || didTruncateFallback
      }

    }

    return DataPayload(nodes: nodes, truncated: truncated)
  }

  func snapshotRaw(app: XCUIApplication, options: SnapshotOptions) -> DataPayload {
    if let blocking = blockingSystemAlertSnapshot() {
      return blocking
    }

    guard let context = makeSnapshotTraversalContext(app: app, options: options) else {
      return DataPayload(nodes: [], truncated: false)
    }

    var nodes: [SnapshotNode] = []
    var truncated = false

    func walk(_ snapshot: XCUIElementSnapshot, depth: Int) {
      if nodes.count >= maxSnapshotElements {
        truncated = true
        return
      }
      if let limit = options.depth, depth > limit { return }

      let evaluation = evaluateSnapshot(snapshot, in: context)
      if shouldInclude(
        snapshot: snapshot,
        label: evaluation.label,
        identifier: evaluation.identifier,
        valueText: evaluation.valueText,
        options: options,
        hittable: evaluation.hittable,
        visible: evaluation.visible
      ) {
        nodes.append(
          makeSnapshotNode(snapshot: snapshot, evaluation: evaluation, depth: depth, index: nodes.count)
        )
      }

      let children = snapshot.children
      for child in children {
        walk(child, depth: depth + 1)
        if truncated { return }
      }
    }

    walk(context.rootSnapshot, depth: 0)
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
    hittable: Bool,
    visible: Bool
  ) -> Bool {
    let type = snapshot.elementType
    let hasContent = !label.isEmpty || !identifier.isEmpty || (valueText != nil)
    if options.compact && type == .other && !hasContent && !hittable {
      if snapshot.children.count <= 1 { return false }
    }
    if options.interactiveOnly {
      #if os(macOS)
        if !visible && type != .application {
          return false
        }
      #endif
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

  private func makeSnapshotTraversalContext(
    app: XCUIApplication,
    options: SnapshotOptions
  ) -> SnapshotTraversalContext? {
    let viewport = snapshotViewport(app: app)
    let queryRoot = options.scope.flatMap { findScopeElement(app: app, scope: $0) } ?? app

    let rootSnapshot: XCUIElementSnapshot
    do {
      rootSnapshot = try queryRoot.snapshot()
    } catch {
      return nil
    }

    let (flatSnapshots, snapshotRanges) = flattenedSnapshots(rootSnapshot)
    return SnapshotTraversalContext(
      queryRoot: queryRoot,
      rootSnapshot: rootSnapshot,
      viewport: viewport,
      flatSnapshots: flatSnapshots,
      snapshotRanges: snapshotRanges,
      maxDepth: options.depth ?? Int.max
    )
  }

  private func evaluateSnapshot(
    _ snapshot: XCUIElementSnapshot,
    in context: SnapshotTraversalContext
  ) -> SnapshotEvaluation {
    let label = aggregatedLabel(for: snapshot) ?? snapshot.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let identifier = snapshot.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    let valueText = snapshotValueText(snapshot)
    let laterNodes = laterSnapshots(
      for: snapshot,
      in: context.flatSnapshots,
      ranges: context.snapshotRanges
    )
    return SnapshotEvaluation(
      label: label,
      identifier: identifier,
      valueText: valueText,
      hittable: computedSnapshotHittable(snapshot, viewport: context.viewport, laterNodes: laterNodes),
      visible: isVisibleInViewport(snapshot.frame, context.viewport)
    )
  }

  private func makeSnapshotNode(
    snapshot: XCUIElementSnapshot,
    evaluation: SnapshotEvaluation,
    depth: Int,
    index: Int
  ) -> SnapshotNode {
    return SnapshotNode(
      index: index,
      type: elementTypeName(snapshot.elementType),
      label: evaluation.label.isEmpty ? nil : evaluation.label,
      identifier: evaluation.identifier.isEmpty ? nil : evaluation.identifier,
      value: evaluation.valueText,
      rect: snapshotRect(from: snapshot.frame),
      enabled: snapshot.isEnabled,
      hittable: evaluation.hittable,
      depth: depth
    )
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

  private func snapshotViewport(app: XCUIApplication) -> CGRect {
    let windows = app.windows.allElementsBoundByIndex
    if let window = windows.first(where: { $0.exists && !$0.frame.isNull && !$0.frame.isEmpty }) {
      return window.frame
    }
    let appFrame = app.frame
    if !appFrame.isNull && !appFrame.isEmpty {
      return appFrame
    }
    return .infinite
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

  private func appendCollapsedTabFallbackNodes(
    to nodes: inout [SnapshotNode],
    containerSnapshot: XCUIElementSnapshot,
    resolveElements: () -> [XCUIElement],
    depth: Int,
    nodeLimit: Int
  ) -> Bool {
    let fallbackNodes = collapsedTabFallbackNodes(
      for: containerSnapshot,
      resolveElements: resolveElements,
      startingIndex: nodes.count,
      depth: depth
    )
    if fallbackNodes.isEmpty { return false }
    let remaining = max(0, nodeLimit - nodes.count)
    if remaining == 0 { return true }
    nodes.append(contentsOf: fallbackNodes.prefix(remaining))
    return fallbackNodes.count > remaining
  }

  private func collapsedTabFallbackNodes(
    for containerSnapshot: XCUIElementSnapshot,
    resolveElements: () -> [XCUIElement],
    startingIndex: Int,
    depth: Int
  ) -> [SnapshotNode] {
    if !containerSnapshot.children.isEmpty { return [] }
    guard shouldExpandCollapsedTabContainer(containerSnapshot) else { return [] }
    let containerFrame = containerSnapshot.frame
    if containerFrame.isNull || containerFrame.isEmpty { return [] }

    // Collapsed tab containers should be rare, so a full descendant scan is acceptable once per
    // snapshot as a fallback for XCTest omitting the tab children from the snapshot tree.
    let elements = resolveElements()
    let candidates = elements.compactMap { element in
      collapsedTabCandidateNode(
        element: element,
        containerSnapshot: containerSnapshot,
        containerFrame: containerFrame
      )
    }
    .sorted { left, right in
      if left.rect.x != right.rect.x {
        return left.rect.x < right.rect.x
      }
      return left.rect.y < right.rect.y
    }

    if candidates.count < 2 { return [] }
    let rowMidpoints = candidates.map { $0.rect.y + ($0.rect.height / 2) }
    let rowSpread = (rowMidpoints.max() ?? 0) - (rowMidpoints.min() ?? 0)
    // Allow modest vertical jitter and short two-row wraps while still rejecting unrelated controls.
    if rowSpread > max(24.0, Double(containerFrame.height) * 0.6) { return [] }

    var seen = Set<String>()
    let uniqueCandidates = candidates.filter { node in
      let key = "\(node.type)-\(node.label ?? "")-\(node.identifier ?? "")-\(node.value ?? "")-\(node.rect.x)-\(node.rect.y)-\(node.rect.width)-\(node.rect.height)"
      if seen.contains(key) { return false }
      seen.insert(key)
      return true
    }
    if uniqueCandidates.count < 2 { return [] }

    return uniqueCandidates.enumerated().map { offset, node in
      SnapshotNode(
        index: startingIndex + offset,
        type: node.type,
        label: node.label,
        identifier: node.identifier,
        value: node.value,
        rect: node.rect,
        enabled: node.enabled,
        hittable: node.hittable,
        depth: depth
      )
    }
  }

  private func collapsedTabCandidateNode(
    element: XCUIElement,
    containerSnapshot: XCUIElementSnapshot,
    containerFrame: CGRect
  ) -> SnapshotNode? {
    var node: SnapshotNode?
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      if !element.exists { return }
      let elementType = element.elementType
      if !Self.collapsedTabCandidateTypes.contains(elementType) { return }
      let frame = element.frame
      if frame.isNull || frame.isEmpty { return }
      if frame.equalTo(containerFrame) { return }
      let area = max(CGFloat(1), frame.width * frame.height)
      let containerArea = max(CGFloat(1), containerFrame.width * containerFrame.height)
      if area >= containerArea * 0.9 { return }
      let center = CGPoint(x: frame.midX, y: frame.midY)
      if !containerFrame.contains(center) { return }

      let label = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
      let identifier = element.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
      let valueText = snapshotValueText(element)
      let hasContent = !label.isEmpty || !identifier.isEmpty || valueText != nil
      if !hasContent { return }
      if sameSemanticElement(
        containerSnapshot: containerSnapshot,
        elementType: elementType,
        label: label,
        identifier: identifier
      ) {
        return
      }

      node = SnapshotNode(
        index: 0,
        type: elementTypeName(elementType),
        label: label.isEmpty ? nil : label,
        identifier: identifier.isEmpty ? nil : identifier,
        value: valueText,
        rect: snapshotRect(from: frame),
        enabled: element.isEnabled,
        hittable: element.isHittable,
        depth: 0
      )
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_SNAPSHOT_TAB_FALLBACK_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return nil
    }
    return node
  }

  private func shouldExpandCollapsedTabContainer(_ snapshot: XCUIElementSnapshot) -> Bool {
    let frame = snapshot.frame
    if frame.isNull || frame.isEmpty { return false }
    if frame.width < max(CGFloat(160), frame.height * 1.75) { return false }
    switch snapshot.elementType {
    case .tabBar, .segmentedControl, .slider:
      return true
    default:
      return false
    }
  }

  private func snapshotValueText(_ element: XCUIElement) -> String? {
    let text = String(describing: element.value ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }

  private func sameSemanticElement(
    containerSnapshot: XCUIElementSnapshot,
    elementType: XCUIElement.ElementType,
    label: String,
    identifier: String
  ) -> Bool {
    if containerSnapshot.elementType != elementType { return false }
    let containerLabel = containerSnapshot.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let containerIdentifier = containerSnapshot.identifier
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return containerLabel == label && containerIdentifier == identifier
  }

  private func safeSnapshotElementsQuery(_ fetch: () -> [XCUIElement]) -> [XCUIElement] {
    var elements: [XCUIElement] = []
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      elements = fetch()
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_SNAPSHOT_QUERY_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return []
    }
    return elements
  }
}
