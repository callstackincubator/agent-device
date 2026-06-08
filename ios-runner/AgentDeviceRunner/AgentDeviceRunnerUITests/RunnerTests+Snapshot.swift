import XCTest

extension RunnerTests {
  private static let axSnapshotErrorCode = "IOS_AX_SNAPSHOT_FAILED"
  private static let axSnapshotFailureMessage =
    "iOS XCTest snapshot failed while serializing the accessibility tree."
  private static let axSnapshotUnavailableReason = "ax_snapshot_unavailable"
  private static let axSnapshotHint =
    "Snapshot state is unavailable because XCTest could not serialize this iOS accessibility tree. This can be specific to the current screen. Use plain screenshot, not screenshot --overlay-refs, as visual truth; navigate with coordinate commands if needed; then retry snapshot -i after reaching another screen. If you own the app and need full-tree inspection, simplify this screen's accessibility tree and expose stable ids on actionable controls."
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
  private static let flatInteractiveFallbackBudget: TimeInterval = 1.0

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
    let focused: Bool
    let selected: Bool
    let visible: Bool
  }

  private enum SnapshotTraversalCapture {
    case context(SnapshotTraversalContext)
    case fallback(DataPayload)
    case empty
  }

  struct SnapshotCaptureFailure: Error {
    let code: String
    let message: String
    let hint: String
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
    if options.interactiveOnly && options.compact {
      return snapshotFlatInteractive(app: app, options: options)
    }
    if let blocking = blockingSystemAlertSnapshot() {
      return blocking
    }

    let capture = try captureSnapshotTraversalContext(
      app: app,
      options: options,
      allowInteractiveUnavailableFallback: true
    )
    let context: SnapshotTraversalContext
    switch capture {
    case .context(let traversalContext):
      context = traversalContext
    case .fallback(let fallback):
      return fallback
    case .empty:
      return DataPayload(nodes: [], truncated: false)
    }

    var cachedDescendantElements: [XCUIElement]?
    func collapsedTabDescendants() -> [XCUIElement] {
      if let cachedDescendantElements {
        return cachedDescendantElements
      }
      let result = snapshotElementsQuery {
        context.queryRoot.descendants(matching: .any).allElementsBoundByIndex
      }
      cachedDescendantElements = result.elements
      return result.elements
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

      let currentIndex = include && !isDuplicate ? nodes.count : parentIndex
      if depth < context.maxDepth {
        let nextVisibleDepth = include && !isDuplicate ? visibleDepth + 1 : visibleDepth
        for child in snapshot.children.reversed() {
          stack.append((child, depth + 1, nextVisibleDepth, currentIndex))
        }
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

    return DataPayload(nodes: nodes, truncated: truncated)
  }

  func snapshotRaw(app: XCUIApplication, options: SnapshotOptions) throws -> DataPayload {
    if let blocking = blockingSystemAlertSnapshot() {
      return blocking
    }

    let capture = try captureSnapshotTraversalContext(
      app: app,
      options: options,
      allowInteractiveUnavailableFallback: false
    )
    let context: SnapshotTraversalContext
    switch capture {
    case .context(let traversalContext):
      context = traversalContext
    case .fallback(let fallback):
      return fallback
    case .empty:
      return DataPayload(nodes: [], truncated: false)
    }

    var nodes: [SnapshotNode] = []
    var truncated = false

    func walk(_ snapshot: XCUIElementSnapshot, depth: Int, parentIndex: Int?) {
      if nodes.count >= maxSnapshotElements {
        truncated = true
        return
      }
      if let limit = options.depth, depth > limit { return }

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
      for child in children {
        walk(child, depth: depth + 1, parentIndex: currentIndex)
        if truncated { return }
      }
    }

    walk(context.rootSnapshot, depth: 0, parentIndex: nil)
    return DataPayload(nodes: nodes, truncated: truncated)
  }

  private func snapshotFlatInteractive(app: XCUIApplication, options: SnapshotOptions) -> DataPayload {
    var nodes: [SnapshotNode] = [
      compactInteractiveRootNode(rect: .zero)
    ]
    if options.depth == 0 {
      return DataPayload(nodes: nodes, truncated: false)
    }

    let deadline = options.interactiveOnly
      ? Date().addingTimeInterval(Self.flatInteractiveFallbackBudget)
      : Date.distantFuture
    let viewport = safeSnapshotViewport(app: app)
    var seen = Set<String>()
    var candidates: [SnapshotNode] = []
    for element in flatInteractiveElements(app: app, deadline: deadline) {
      if Date() >= deadline {
        NSLog("AGENT_DEVICE_RUNNER_SNAPSHOT_FLAT_FALLBACK_DEADLINE")
        break
      }
      guard let node = flatSnapshotNode(
        element: element,
        index: 0,
        parentIndex: 0,
        viewport: viewport,
        options: options
      ) else {
        continue
      }
      let key = "\(node.type)-\(node.label ?? "")-\(node.identifier ?? "")-\(node.value ?? "")-\(node.rect.x)-\(node.rect.y)-\(node.rect.width)-\(node.rect.height)"
      if seen.contains(key) { continue }
      seen.insert(key)
      candidates.append(node)
    }
    candidates.sort { left, right in
      if left.rect.y != right.rect.y {
        return left.rect.y < right.rect.y
      }
      if left.rect.x != right.rect.x {
        return left.rect.x < right.rect.x
      }
      return left.type < right.type
    }

    let remaining = max(0, fastSnapshotLimit - nodes.count)
    let truncated = candidates.count > remaining
    nodes[0] = compactInteractiveRootNode(rect: compactInteractiveRootFrame(for: candidates))
    for candidate in candidates.prefix(remaining) {
      nodes.append(
        SnapshotNode(
          index: nodes.count,
          type: candidate.type,
          label: candidate.label,
          identifier: candidate.identifier,
          value: candidate.value,
          rect: candidate.rect,
          enabled: candidate.enabled,
          focused: candidate.focused,
          selected: candidate.selected,
          hittable: candidate.hittable,
          depth: 1,
          parentIndex: 0,
          hiddenContentAbove: nil,
          hiddenContentBelow: nil
        )
      )
    }
    return DataPayload(nodes: nodes, truncated: truncated)
  }

  private func snapshotAccessibilityUnavailable(failure: SnapshotCaptureFailure) -> DataPayload {
    NSLog("AGENT_DEVICE_RUNNER_SNAPSHOT_AX_UNAVAILABLE=%@", failure.message)
    invalidateCachedTarget(reason: Self.axSnapshotUnavailableReason)
    return sparseTruncatedSnapshotPayload(
      message: recoveredSnapshotMessage(failure),
      runnerFatal: true,
      runnerFatalReason: Self.axSnapshotUnavailableReason
    )
  }

  private func captureSnapshotTraversalContext(
    app: XCUIApplication,
    options: SnapshotOptions,
    allowInteractiveUnavailableFallback: Bool
  ) throws -> SnapshotTraversalCapture {
    do {
      guard let context = try makeSnapshotTraversalContext(app: app, options: options) else {
        return .empty
      }
      return .context(context)
    } catch let failure as SnapshotCaptureFailure {
      if let fallback = snapshotDepthLimitedAccessibilityFallback(
        app: app,
        options: options,
        failure: failure
      ) {
        return .fallback(fallback)
      }
      if allowInteractiveUnavailableFallback && options.interactiveOnly {
        return .fallback(snapshotAccessibilityUnavailable(failure: failure))
      }
      throw failure
    }
  }

  private func snapshotDepthLimitedAccessibilityFallback(
    app: XCUIApplication,
    options: SnapshotOptions,
    failure: SnapshotCaptureFailure
  ) -> DataPayload? {
    guard let requestedDepth = options.depth else {
      return nil
    }

    NSLog(
      "AGENT_DEVICE_RUNNER_SNAPSHOT_DEPTH_FALLBACK=%@",
      failure.message
    )

    if requestedDepth <= 0 {
      return sparseTruncatedSnapshotPayload(message: recoveredSnapshotMessage(failure))
    }

    // Raw depth-limited recovery intentionally falls back to sparse interactive discovery because
    // the raw AX tree is the failed operation.
    let fallback = snapshotFlatInteractive(
      app: app,
      options: SnapshotOptions(
        interactiveOnly: true,
        compact: options.compact,
        depth: requestedDepth,
        scope: options.scope,
        raw: false
      )
    )
    return DataPayload(
      message: recoveredSnapshotMessage(failure),
      nodes: fallback.nodes,
      truncated: true
    )
  }

  private func recoveredSnapshotMessage(_ failure: SnapshotCaptureFailure) -> String {
    return "\(failure.message) Hint: \(failure.hint)"
  }

  private func sparseTruncatedSnapshotPayload(
    message: String,
    runnerFatal: Bool? = nil,
    runnerFatalReason: String? = nil
  ) -> DataPayload {
    return DataPayload(
      message: message,
      nodes: [compactInteractiveRootNode(rect: .zero)],
      truncated: true,
      runnerFatal: runnerFatal,
      runnerFatalReason: runnerFatalReason
    )
  }

  func testSnapshotAccessibilityUnavailableMarksSparseSnapshotRunnerFatal() {
    currentApp = app
    currentBundleId = "com.example.app"

    let payload = snapshotAccessibilityUnavailable(
      failure: SnapshotCaptureFailure(
        code: Self.axSnapshotErrorCode,
        message: Self.axSnapshotFailureMessage,
        hint: Self.axSnapshotHint
      )
    )

    XCTAssertEqual(payload.message, "\(Self.axSnapshotFailureMessage) Hint: \(Self.axSnapshotHint)")
    XCTAssertEqual(payload.nodes?.count, 1)
    XCTAssertEqual(payload.nodes?.first?.type, "Application")
    XCTAssertEqual(payload.truncated, true)
    XCTAssertEqual(payload.runnerFatal, true)
    XCTAssertEqual(payload.runnerFatalReason, Self.axSnapshotUnavailableReason)
    XCTAssertNil(currentApp)
    XCTAssertNil(currentBundleId)
  }

  func testRecoveredSnapshotMessagePreservesHint() {
    let message = recoveredSnapshotMessage(
      SnapshotCaptureFailure(
        code: Self.axSnapshotErrorCode,
        message: Self.axSnapshotFailureMessage,
        hint: Self.axSnapshotHint
      )
    )

    XCTAssertTrue(message.contains(Self.axSnapshotFailureMessage))
    XCTAssertTrue(message.contains(Self.axSnapshotHint))
  }

  func testDepthLimitedSnapshotFailureReturnsNonFatalFallback() {
    currentApp = app
    currentBundleId = "com.example.app"

    let payload = snapshotDepthLimitedAccessibilityFallback(
      app: app,
      options: SnapshotOptions(
        interactiveOnly: false,
        compact: false,
        depth: 0,
        scope: nil,
        raw: false
      ),
      failure: SnapshotCaptureFailure(
        code: Self.axSnapshotErrorCode,
        message: "\(Self.axSnapshotFailureMessage) kAXErrorIllegalArgument.",
        hint: Self.axSnapshotHint
      )
    )

    XCTAssertEqual(
      payload?.message,
      "\(Self.axSnapshotFailureMessage) kAXErrorIllegalArgument. Hint: \(Self.axSnapshotHint)"
    )
    XCTAssertEqual(payload?.nodes?.count, 1)
    XCTAssertEqual(payload?.nodes?.first?.type, "Application")
    XCTAssertEqual(payload?.truncated, true)
    XCTAssertNil(payload?.runnerFatal)
    XCTAssertNil(payload?.runnerFatalReason)
    XCTAssertNotNil(currentApp)
    XCTAssertEqual(currentBundleId, "com.example.app")
  }

  private func compactInteractiveRootNode(rect: CGRect) -> SnapshotNode {
    SnapshotNode(
      index: 0,
      type: "Application",
      label: nil,
      identifier: nil,
      value: nil,
      rect: snapshotRect(from: rect),
      enabled: true,
      focused: nil,
      selected: nil,
      hittable: false,
      depth: 0,
      parentIndex: nil,
      hiddenContentAbove: nil,
      hiddenContentBelow: nil
    )
  }

  private func compactInteractiveRootFrame(for candidates: [SnapshotNode]) -> CGRect {
    guard !candidates.isEmpty else {
      return .zero
    }
    let maxX = candidates.map { CGFloat($0.rect.x + $0.rect.width) }.max() ?? 0
    let maxY = candidates.map { CGFloat($0.rect.y + $0.rect.height) }.max() ?? 0
    return CGRect(x: 0, y: 0, width: max(1, maxX), height: max(1, maxY))
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
    let queryRoot = options.scope.flatMap { findScopeElement(app: app, scope: $0) } ?? app

    guard let rootSnapshot = try captureSnapshotRoot(queryRoot) else {
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

  private func captureSnapshotRoot(_ element: XCUIElement) throws -> XCUIElementSnapshot? {
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
      return rootSnapshot
    }
    let message = exceptionMessage ?? swiftErrorMessage ?? "snapshot returned no root"
    if Self.isAxIllegalArgument(message) {
      throw axSnapshotFailure(message)
    }
    return nil
  }

  private func safeSnapshotViewport(app: XCUIApplication) -> CGRect {
    safely("SNAPSHOT_VIEWPORT", CGRect.infinite) { snapshotViewport(app: app) }
  }

  private func describeSnapshotError(_ error: Error) -> String {
    let localized = error.localizedDescription
    let debug = String(describing: error)
    if localized.isEmpty { return debug }
    if debug == localized { return localized }
    return "\(localized) (\(debug))"
  }

  private func axSnapshotFailure(_ message: String) -> SnapshotCaptureFailure {
    let detail = message.trimmingCharacters(in: .whitespacesAndNewlines)
    let failureMessage: String
    if detail.isEmpty {
      failureMessage = Self.axSnapshotFailureMessage
    } else {
      failureMessage = "\(Self.axSnapshotFailureMessage) \(detail)"
    }
    return SnapshotCaptureFailure(
      code: Self.axSnapshotErrorCode,
      message: failureMessage,
      hint: Self.axSnapshotHint
    )
  }

  private static func isAxIllegalArgument(_ message: String) -> Bool {
    let normalized = message.lowercased()
    return normalized.contains("kaxerrorillegalargument")
      || (normalized.contains("illegal argument") && normalized.contains("snapshot"))
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
    let windowFrames = windows
      .filter { $0.exists && !$0.frame.isNull && !$0.frame.isEmpty }
      .map(\.frame)
    if let largestWindowFrame = windowFrames.max(by: { left, right in
      left.width * left.height < right.width * right.height
    }) {
      return largestWindowFrame
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

  private func flatInteractiveElements(
    app: XCUIApplication,
    deadline: Date
  ) -> [XCUIElement] {
    let queries: [XCUIElementQuery] = [
      app.buttons,
      app.links,
      app.textFields,
      app.secureTextFields,
      app.searchFields,
      app.textViews,
      app.switches,
      app.sliders,
      app.segmentedControls,
      app.cells,
      app.collectionViews,
      app.tables,
      app.scrollViews,
      app.pickers,
      app.steppers,
      app.tabBars,
      app.menuItems,
      app.staticTexts,
      app.images
    ]

    var elements: [XCUIElement] = []
    for query in queries {
      if Date() >= deadline {
        NSLog("AGENT_DEVICE_RUNNER_SNAPSHOT_FLAT_FALLBACK_DEADLINE")
        break
      }
      let result = snapshotElementsQuery {
        query.allElementsBoundByIndex
      }
      elements.append(contentsOf: result.elements)
      if result.axUnavailable {
        break
      }
    }
    return elements
  }

  private func snapshotElementsQuery(
    _ fetch: () -> [XCUIElement]
  ) -> (elements: [XCUIElement], axUnavailable: Bool) {
    let (elements, exceptionMessage) = catchingObjCException(fallback: [], fetch)
    guard let exceptionMessage else {
      return (elements, false)
    }
    NSLog("AGENT_DEVICE_RUNNER_SNAPSHOT_QUERY_IGNORED_EXCEPTION=%@", exceptionMessage)
    if Self.isAxIllegalArgument(exceptionMessage) {
      invalidateCachedTarget(reason: "ax_snapshot_query_unavailable")
      return ([], true)
    }
    return ([], false)
  }

  private func flatSnapshotNode(
    element: XCUIElement,
    index: Int,
    parentIndex: Int?,
    viewport: CGRect,
    options: SnapshotOptions
  ) -> SnapshotNode? {
    var node: SnapshotNode?
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      if !element.exists { return }
      let frame = element.frame
      if frame.isNull || frame.isEmpty { return }
      let visible = isVisibleInViewport(frame, viewport)
      if options.interactiveOnly && !visible { return }
      #if os(macOS)
        if !visible { return }
      #endif
      let label = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
      let identifier = element.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
      let valueText = snapshotValueText(element)
      let hasContent = !label.isEmpty || !identifier.isEmpty || valueText != nil
      let elementType = element.elementType
      let enabled = element.isEnabled
      let hittable = visible && enabled && element.isHittable
      if options.compact && !hasContent && !hittable && !interactiveTypes.contains(elementType) {
        return
      }
      if let scope = options.scope?.trimmingCharacters(in: .whitespacesAndNewlines), !scope.isEmpty {
        let haystack = [label, identifier, valueText ?? ""].joined(separator: "\n")
        if !haystack.localizedCaseInsensitiveContains(scope) {
          return
        }
      }

      node = SnapshotNode(
        index: index,
        type: elementTypeName(elementType),
        label: label.isEmpty ? nil : label,
        identifier: identifier.isEmpty ? nil : identifier,
        value: valueText,
        rect: snapshotRect(from: frame),
        enabled: enabled,
        focused: elementHasFocus(element) ? true : nil,
        selected: element.isSelected ? true : nil,
        hittable: hittable,
        depth: 1,
        parentIndex: parentIndex,
        hiddenContentAbove: nil,
        hiddenContentBelow: nil
      )
    })
    if let exceptionMessage {
      NSLog("AGENT_DEVICE_RUNNER_SNAPSHOT_FLAT_IGNORED_EXCEPTION=%@", exceptionMessage)
      return nil
    }
    return node
  }

  private func isScrollableContainer(_ snapshot: XCUIElementSnapshot, visible: Bool) -> Bool {
    if !visible { return false }
    if !Self.scrollContainerTypes.contains(snapshot.elementType) { return false }
    return !snapshot.children.isEmpty
  }
}
