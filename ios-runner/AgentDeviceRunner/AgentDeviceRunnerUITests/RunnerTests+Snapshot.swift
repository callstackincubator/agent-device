import XCTest

extension RunnerTests {
  private static let appleSnapshotMaxDepth = 60
  private static let axSnapshotErrorCode = "IOS_AX_SNAPSHOT_FAILED"
  private static let axSnapshotHint =
    "This can happen with a React Native deep accessibility tree. Flatten app-side if this screen must be fully inspectable; screenshot, logs, appstate, and open --relaunch can still be used in the same session."
  private static let collapsedTabCandidateTypes: Set<XCUIElement.ElementType> = [
    .button,
    .link,
    .menuItem,
    .other,
    .staticText
  ]
  private static let scrollContainerTypes: Set<XCUIElement.ElementType> = [
    .collectionView,
    .scrollView,
    .table
  ]

  private struct SnapshotTraversalContext {
    let queryRoot: XCUIElement
    let rootSnapshot: XCUIElementSnapshot
    let viewport: CGRect
    let flatSnapshots: [XCUIElementSnapshot]
    let snapshotRanges: [ObjectIdentifier: (Int, Int)]
    let maxDepth: Int
    let partial: Bool
    let warnings: [String]
  }

  private struct SnapshotEvaluation {
    let label: String
    let identifier: String
    let valueText: String?
    let hittable: Bool
    let focused: Bool
    let selected: Bool
    let visible: Bool
  }

  struct SnapshotCaptureFailure: Error {
    let code: String
    let message: String
    let hint: String
  }

  private struct SnapshotRootCandidate {
    let label: String
    let element: XCUIElement
  }

  private struct SnapshotRootFailure: Error {
    let rootLabel: String
    let message: String

    var isAxIllegalArgument: Bool {
      RunnerTests.isAxIllegalArgument(message)
    }
  }

  private struct SnapshotRootCapture {
    let queryRoot: XCUIElement
    let rootSnapshot: XCUIElementSnapshot
    let maxDepth: Int
    let partial: Bool
    let warnings: [String]
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

  func snapshotFast(app: XCUIApplication, options: SnapshotOptions) throws -> DataPayload {
    if let blocking = blockingSystemAlertSnapshot() {
      return blocking
    }

    guard let context = try makeSnapshotTraversalContext(app: app, options: options) else {
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
      makeSnapshotNode(
        snapshot: context.rootSnapshot,
        evaluation: rootEvaluation,
        depth: 0,
        index: 0,
        parentIndex: nil
      )
    )
    if context.maxDepth == 0 && !context.rootSnapshot.children.isEmpty {
      truncated = true
    }
    if context.maxDepth > 0 {
      let didTruncateFallback = appendCollapsedTabFallbackNodes(
        to: &nodes,
        containerSnapshot: context.rootSnapshot,
        resolveElements: collapsedTabDescendants,
        depth: 1,
        parentIndex: 0,
        nodeLimit: fastSnapshotLimit
      )
      truncated = truncated || didTruncateFallback
    }

    var seen = Set<String>()
    var stack: [(XCUIElementSnapshot, Int, Int, Int?)] = context.rootSnapshot.children.map {
      ($0, 1, 1, 0)
    }

    while let (snapshot, depth, visibleDepth, parentIndex) = stack.popLast() {
      if nodes.count >= fastSnapshotLimit {
        truncated = true
        break
      }
      if depth > context.maxDepth { continue }

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

      let currentIndex = include && !isDuplicate ? nodes.count : parentIndex
      if depth < context.maxDepth {
        let nextVisibleDepth = include && !isDuplicate ? visibleDepth + 1 : visibleDepth
        for child in snapshot.children.reversed() {
          stack.append((child, depth + 1, nextVisibleDepth, currentIndex))
        }
      } else if !snapshot.children.isEmpty {
        truncated = true
      }

      if !include || isDuplicate { continue }

      let index = nodes.count
      nodes.append(
        makeSnapshotNode(
          snapshot: snapshot,
          evaluation: evaluation,
          depth: min(context.maxDepth, visibleDepth),
          index: index,
          parentIndex: parentIndex
        )
      )
      if visibleDepth < context.maxDepth {
        let didTruncateFallback = appendCollapsedTabFallbackNodes(
          to: &nodes,
          containerSnapshot: snapshot,
          resolveElements: collapsedTabDescendants,
          depth: visibleDepth + 1,
          parentIndex: index,
          nodeLimit: fastSnapshotLimit
        )
        truncated = truncated || didTruncateFallback
      }

    }

    return DataPayload(
      nodes: nodes,
      truncated: truncated || context.partial,
      warnings: snapshotWarnings(context)
    )
  }

  func snapshotRaw(app: XCUIApplication, options: SnapshotOptions) throws -> DataPayload {
    if let blocking = blockingSystemAlertSnapshot() {
      return blocking
    }

    guard let context = try makeSnapshotTraversalContext(app: app, options: options) else {
      return DataPayload(nodes: [], truncated: false)
    }

    var nodes: [SnapshotNode] = []
    var truncated = false

    func walk(_ snapshot: XCUIElementSnapshot, depth: Int, parentIndex: Int?) {
      if nodes.count >= maxSnapshotElements {
        truncated = true
        return
      }
      if depth > context.maxDepth { return }

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
      let currentIndex = include ? nodes.count : parentIndex
      if include {
        nodes.append(
          makeSnapshotNode(
            snapshot: snapshot,
            evaluation: evaluation,
            depth: depth,
            index: nodes.count,
            parentIndex: parentIndex
          )
        )
      }

      let children = snapshot.children
      if depth >= context.maxDepth && !children.isEmpty {
        truncated = true
        return
      }
      for child in children {
        walk(child, depth: depth + 1, parentIndex: currentIndex)
        if truncated { return }
      }
    }

    walk(context.rootSnapshot, depth: 0, parentIndex: nil)
    return DataPayload(
      nodes: nodes,
      truncated: truncated || context.partial,
      warnings: snapshotWarnings(context)
    )
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
      if isScrollableContainer(snapshot, visible: visible) { return true }
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
  ) throws -> SnapshotTraversalContext? {
    let viewport = safeSnapshotViewport(app: app)
    guard let capture = try captureSnapshotRoot(app: app, options: options) else {
      return nil
    }

    let (flatSnapshots, snapshotRanges) = flattenedSnapshots(
      capture.rootSnapshot,
      maxDepth: capture.maxDepth
    )
    return SnapshotTraversalContext(
      queryRoot: capture.queryRoot,
      rootSnapshot: capture.rootSnapshot,
      viewport: viewport,
      flatSnapshots: flatSnapshots,
      snapshotRanges: snapshotRanges,
      maxDepth: capture.maxDepth,
      partial: capture.partial,
      warnings: capture.warnings
    )
  }

  private func captureSnapshotRoot(
    app: XCUIApplication,
    options: SnapshotOptions
  ) throws -> SnapshotRootCapture? {
    let requestedDepth = max(options.depth ?? Self.appleSnapshotMaxDepth, 0)
    let maxDepth = min(requestedDepth, Self.appleSnapshotMaxDepth)
    var warnings: [String] = []
    if requestedDepth > Self.appleSnapshotMaxDepth {
      warnings.append(
        "iOS XCTest snapshot depth \(requestedDepth) was clamped to \(Self.appleSnapshotMaxDepth) to stay below Apple's depth limit."
      )
    }

    let scopedRoot = options.scope.flatMap { findScopeElement(app: app, scope: $0) }
    let queryRoot = scopedRoot ?? app
    let primaryLabel = scopedRoot == nil ? "app" : "scope"
    switch captureElementSnapshot(queryRoot, label: primaryLabel) {
    case .success(let snapshot):
      return SnapshotRootCapture(
        queryRoot: queryRoot,
        rootSnapshot: snapshot,
        maxDepth: maxDepth,
        partial: false,
        warnings: warnings
      )
    case .failure(let primaryFailure):
      guard primaryFailure.isAxIllegalArgument else {
        return nil
      }
      if scopedRoot != nil {
        throw axSnapshotFailure([primaryFailure])
      }

      var failures = [primaryFailure]
      for candidate in fallbackSnapshotRootCandidates(app: app) {
        switch captureElementSnapshot(candidate.element, label: candidate.label) {
        case .success(let snapshot):
          var partialWarnings = warnings
          partialWarnings.append(axSnapshotPartialWarning(from: primaryFailure, recoveredWith: candidate.label))
          return SnapshotRootCapture(
            queryRoot: candidate.element,
            rootSnapshot: snapshot,
            maxDepth: maxDepth,
            partial: true,
            warnings: partialWarnings
          )
        case .failure(let failure):
          failures.append(failure)
        }
      }
      throw axSnapshotFailure(failures)
    }
  }

  private func captureElementSnapshot(
    _ element: XCUIElement,
    label: String
  ) -> Result<XCUIElementSnapshot, SnapshotRootFailure> {
    var rootSnapshot: XCUIElementSnapshot?
    var swiftErrorMessage: String?
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      do {
        rootSnapshot = try element.snapshot()
      } catch {
        swiftErrorMessage = describeSnapshotError(error)
      }
    })

    if let rootSnapshot {
      return .success(rootSnapshot)
    }
    return .failure(
      SnapshotRootFailure(
        rootLabel: label,
        message: exceptionMessage ?? swiftErrorMessage ?? "snapshot returned no root"
      )
    )
  }

  private func fallbackSnapshotRootCandidates(app: XCUIApplication) -> [SnapshotRootCandidate] {
    var candidates: [SnapshotRootCandidate] = []
    let window = app.windows.firstMatch
    if safeElementExists(window) {
      candidates.append(SnapshotRootCandidate(label: "window", element: window))
    }
    let firstChild = app.children(matching: .any).firstMatch
    if safeElementExists(firstChild) {
      candidates.append(SnapshotRootCandidate(label: "first child", element: firstChild))
    }
    let firstOther = app.children(matching: .other).firstMatch
    if safeElementExists(firstOther) {
      candidates.append(SnapshotRootCandidate(label: "first other subtree", element: firstOther))
    }
    return candidates
  }

  private func safeElementExists(_ element: XCUIElement) -> Bool {
    var exists = false
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      exists = element.exists
    })
    if let exceptionMessage {
      NSLog("AGENT_DEVICE_RUNNER_SNAPSHOT_FALLBACK_EXISTS_IGNORED_EXCEPTION=%@", exceptionMessage)
    }
    return exists
  }

  private func safeSnapshotViewport(app: XCUIApplication) -> CGRect {
    var viewport = CGRect.infinite
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      viewport = snapshotViewport(app: app)
    })
    if let exceptionMessage {
      NSLog("AGENT_DEVICE_RUNNER_SNAPSHOT_VIEWPORT_IGNORED_EXCEPTION=%@", exceptionMessage)
    }
    return viewport
  }

  private func describeSnapshotError(_ error: Error) -> String {
    let localized = error.localizedDescription
    let debug = String(describing: error)
    if localized.isEmpty { return debug }
    if debug == localized { return localized }
    return "\(localized) (\(debug))"
  }

  private func axSnapshotFailure(_ failures: [SnapshotRootFailure]) -> SnapshotCaptureFailure {
    let roots = failures.map { "\($0.rootLabel): \($0.message)" }.joined(separator: "; ")
    return SnapshotCaptureFailure(
      code: Self.axSnapshotErrorCode,
      message: "iOS XCTest snapshot failed with kAXErrorIllegalArgument. \(roots)",
      hint: Self.axSnapshotHint
    )
  }

  private func axSnapshotPartialWarning(
    from failure: SnapshotRootFailure,
    recoveredWith rootLabel: String
  ) -> String {
    return "iOS XCTest snapshot hit kAXErrorIllegalArgument at \(failure.rootLabel); returned a partial shallow snapshot from \(rootLabel). React Native deep accessibility tree detected; flatten app-side if this screen must be fully inspectable."
  }

  private static func isAxIllegalArgument(_ message: String) -> Bool {
    let normalized = message.lowercased()
    return normalized.contains("kaxerrorillegalargument")
      || (normalized.contains("illegal argument") && normalized.contains("snapshot"))
  }

  private func snapshotWarnings(_ context: SnapshotTraversalContext) -> [String]? {
    return context.warnings.isEmpty ? nil : context.warnings
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
      focused: snapshotHasFocus(snapshot),
      selected: snapshotIsSelected(snapshot),
      visible: isVisibleInViewport(snapshot.frame, context.viewport)
    )
  }

  private func makeSnapshotNode(
    snapshot: XCUIElementSnapshot,
    evaluation: SnapshotEvaluation,
    depth: Int,
    index: Int,
    parentIndex: Int?
  ) -> SnapshotNode {
    return SnapshotNode(
      index: index,
      type: elementTypeName(snapshot.elementType),
      label: evaluation.label.isEmpty ? nil : evaluation.label,
      identifier: evaluation.identifier.isEmpty ? nil : evaluation.identifier,
      value: evaluation.valueText,
      rect: snapshotRect(from: snapshot.frame),
      enabled: snapshot.isEnabled,
      focused: evaluation.focused ? true : nil,
      selected: evaluation.selected ? true : nil,
      hittable: evaluation.hittable,
      depth: depth,
      parentIndex: parentIndex,
      hiddenContentAbove: nil,
      hiddenContentBelow: nil
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
    _ root: XCUIElementSnapshot,
    maxDepth: Int
  ) -> ([XCUIElementSnapshot], [ObjectIdentifier: (Int, Int)]) {
    var ordered: [XCUIElementSnapshot] = []
    var ranges: [ObjectIdentifier: (Int, Int)] = [:]

    @discardableResult
    func visit(_ snapshot: XCUIElementSnapshot, depth: Int) -> Int {
      let start = ordered.count
      ordered.append(snapshot)
      var end = start
      if depth < maxDepth {
        for child in snapshot.children {
          end = max(end, visit(child, depth: depth + 1))
        }
      }
      ranges[ObjectIdentifier(snapshot)] = (start, end)
      return end
    }

    _ = visit(root, depth: 0)
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
    parentIndex: Int,
    nodeLimit: Int
  ) -> Bool {
    let fallbackNodes = collapsedTabFallbackNodes(
      for: containerSnapshot,
      resolveElements: resolveElements,
      startingIndex: nodes.count,
      depth: depth,
      parentIndex: parentIndex
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
    depth: Int,
    parentIndex: Int
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
        focused: node.focused,
        selected: node.selected,
        hittable: node.hittable,
        depth: depth,
        parentIndex: parentIndex,
        hiddenContentAbove: nil,
        hiddenContentBelow: nil
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
        focused: elementHasFocus(element) ? true : nil,
        selected: element.isSelected ? true : nil,
        hittable: element.isHittable,
        depth: 0,
        parentIndex: nil,
        hiddenContentAbove: nil,
        hiddenContentBelow: nil
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

  private func snapshotHasFocus(_ snapshot: XCUIElementSnapshot) -> Bool {
    var focused = false
    _ = RunnerObjCExceptionCatcher.catchException({
      if let value = (snapshot as! NSObject).value(forKey: "hasFocus") as? Bool {
        focused = value
      }
    })
    return focused
  }

  private func snapshotIsSelected(_ snapshot: XCUIElementSnapshot) -> Bool {
    return snapshot.isSelected
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

  private func isScrollableContainer(_ snapshot: XCUIElementSnapshot, visible: Bool) -> Bool {
    if !visible { return false }
    if !Self.scrollContainerTypes.contains(snapshot.elementType) { return false }
    return !snapshot.children.isEmpty
  }
}
