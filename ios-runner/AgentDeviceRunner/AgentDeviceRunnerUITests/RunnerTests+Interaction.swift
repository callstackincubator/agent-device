import XCTest

extension RunnerTests {
  struct TouchVisualizationFrame {
    let x: Double
    let y: Double
    let referenceWidth: Double
    let referenceHeight: Double
  }

  struct DragVisualizationFrame {
    let x: Double
    let y: Double
    let x2: Double
    let y2: Double
    let referenceWidth: Double
    let referenceHeight: Double
  }

  // MARK: - Navigation Gestures

  func tapInAppBackControl(app: XCUIApplication) -> Bool {
#if os(macOS)
    if let back = macOSNavigationBackElement(app: app) {
      tapElementCenter(app: app, element: back)
      return true
    }
    return false
#elseif os(tvOS)
    _ = pressTvRemote(.menu)
    return true
#else
    let buttons = app.navigationBars.buttons.allElementsBoundByIndex
    if let back = buttons.first(where: { $0.isHittable }) {
      back.tap()
      return true
    }
    return false
#endif
  }

  func performBackGesture(app: XCUIApplication) {
    if pressTvRemote(.menu) {
      return
    }
    performCoordinateBackGesture(app: app)
  }

  private func performCoordinateBackGesture(app: XCUIApplication) {
#if !os(tvOS)
    let target = app.windows.firstMatch.exists ? app.windows.firstMatch : app
    let start = target.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5))
    let end = target.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
    start.press(forDuration: 0.05, thenDragTo: end)
#endif
  }

  func performSystemBackAction(app: XCUIApplication) -> Bool {
#if os(macOS)
    return false
#else
    if pressTvRemote(.menu) {
      return true
    }
    performBackGesture(app: app)
    return true
#endif
  }

  func performAppSwitcherGesture(app: XCUIApplication) {
    if pressTvRemote(.home) {
      sleepFor(resolveTvRemoteDoublePressDelay())
      _ = pressTvRemote(.home)
      return
    }
    performCoordinateAppSwitcherGesture(app: app)
  }

  private func performCoordinateAppSwitcherGesture(app: XCUIApplication) {
#if !os(tvOS)
    let target = app.windows.firstMatch.exists ? app.windows.firstMatch : app
    let start = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99))
    let end = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
    start.press(forDuration: 0.6, thenDragTo: end)
#endif
  }

  func pressHomeButton() {
#if os(macOS)
    return
#else
    if pressTvRemote(.home) {
      return
    }
    XCUIDevice.shared.press(.home)
#endif
  }

  func rotateDevice(to orientationName: String) -> Bool {
#if os(macOS) || os(tvOS)
    return false
#else
    switch orientationName {
    case "portrait":
      XCUIDevice.shared.orientation = .portrait
    case "portrait-upside-down":
      XCUIDevice.shared.orientation = .portraitUpsideDown
    case "landscape-left":
      XCUIDevice.shared.orientation = .landscapeLeft
    case "landscape-right":
      XCUIDevice.shared.orientation = .landscapeRight
    default:
      return false
    }
    sleepFor(0.2)
    return true
#endif
  }

  func findElement(app: XCUIApplication, text: String) -> XCUIElement? {
    let predicate = NSPredicate(format: "label CONTAINS[c] %@ OR identifier CONTAINS[c] %@ OR value CONTAINS[c] %@", text, text, text)
    let element = app.descendants(matching: .any).matching(predicate).firstMatch
    return element.exists ? element : nil
  }

  func readTextAt(app: XCUIApplication, x: Double, y: Double) -> String? {
    let point = CGPoint(x: x, y: y)
    let candidates = app.descendants(matching: .any).allElementsBoundByIndex
      .filter { element in
        element.exists && !element.frame.isEmpty && element.frame.contains(point)
      }
      .sorted { left, right in
        let leftArea = max(1, left.frame.width * left.frame.height)
        let rightArea = max(1, right.frame.width * right.frame.height)
        if leftArea != rightArea {
          return leftArea < rightArea
        }
        if left.frame.minY != right.frame.minY {
          return left.frame.minY < right.frame.minY
        }
        if left.frame.minX != right.frame.minX {
          return left.frame.minX < right.frame.minX
        }
        return left.elementType.rawValue < right.elementType.rawValue
      }

    for element in candidates where prefersExpandedTextRead(element) {
      if let text = readableText(for: element) {
        return text
      }
    }
    for element in candidates {
      if let text = readableText(for: element) {
        return text
      }
    }
    return nil
  }

  func clearTextInput(_ element: XCUIElement) {
#if !os(tvOS)
    moveCaretToEnd(element: element)
#endif
    let count = estimatedDeleteCount(for: element)
    let deletes = String(repeating: XCUIKeyboardKey.delete.rawValue, count: count)
    element.typeText(deletes)
  }

  func textInputAt(app: XCUIApplication, x: Double, y: Double) -> XCUIElement? {
    let point = CGPoint(x: x, y: y)
    var matched: XCUIElement?
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      // Prefer the smallest matching field so nested editable controls win over large containers.
      let candidates = app.descendants(matching: .any).allElementsBoundByIndex
        .filter { element in
          guard element.exists else { return false }
          switch element.elementType {
          case .textField, .secureTextField, .searchField, .textView:
            let frame = element.frame
            return !frame.isEmpty && frame.contains(point)
          default:
            return false
          }
        }
        .sorted { left, right in
          let leftArea = max(1, left.frame.width * left.frame.height)
          let rightArea = max(1, right.frame.width * right.frame.height)
          if leftArea != rightArea {
            return leftArea < rightArea
          }
          if left.frame.minY != right.frame.minY {
            return left.frame.minY < right.frame.minY
          }
          if left.frame.minX != right.frame.minX {
            return left.frame.minX < right.frame.minX
          }
          return left.elementType.rawValue < right.elementType.rawValue
        }
      matched = candidates.first
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_TEXT_INPUT_AT_POINT_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return nil
    }
    return matched
  }

  func focusedTextInput(app: XCUIApplication) -> XCUIElement? {
    var focused: XCUIElement?
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      let candidate = app
        .descendants(matching: .any)
        .matching(NSPredicate(format: "hasKeyboardFocus == 1"))
        .firstMatch
      guard candidate.exists else { return }

      switch candidate.elementType {
      case .textField, .secureTextField, .searchField, .textView:
        focused = candidate
      default:
        return
      }
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_FOCUSED_INPUT_QUERY_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return nil
    }
    return focused
  }

  func isKeyboardVisible(app: XCUIApplication) -> Bool {
    let keyboard = app.keyboards.firstMatch
    return keyboard.exists && !keyboard.frame.isEmpty
  }

  func dismissKeyboard(app: XCUIApplication) -> (wasVisible: Bool, dismissed: Bool, visible: Bool) {
    let wasVisible = isKeyboardVisible(app: app)
    guard wasVisible else {
      return (wasVisible: false, dismissed: false, visible: false)
    }

#if os(tvOS)
    _ = pressTvRemote(.menu)
    sleepFor(0.2)
    let visible = isKeyboardVisible(app: app)
    return (wasVisible: true, dismissed: !visible, visible: visible)
#else
    let keyboard = app.keyboards.firstMatch
    keyboard.swipeDown()
    sleepFor(0.2)
    if !isKeyboardVisible(app: app) {
      return (wasVisible: true, dismissed: true, visible: false)
    }

    if tapKeyboardDismissControl(app: app) {
      sleepFor(0.2)
      let visible = isKeyboardVisible(app: app)
      return (wasVisible: true, dismissed: !visible, visible: visible)
    }

    return (wasVisible: true, dismissed: false, visible: isKeyboardVisible(app: app))
#endif
  }

  private func tapKeyboardDismissControl(app: XCUIApplication) -> Bool {
#if os(tvOS)
    return false
#else
    let keyboardFrame = app.keyboards.firstMatch.frame
    for label in ["Hide keyboard", "Dismiss keyboard", "Done"] {
      let candidates = [
        app.keyboards.buttons[label],
        app.keyboards.keys[label],
        app.keyboards.toolbars.buttons[label],
      ]
      if let hittable = candidates.first(where: { $0.exists && $0.isHittable }) {
        hittable.tap()
        return true
      }

      let toolbarButtonPredicate = NSPredicate(
        format: "label == %@ OR identifier == %@",
        label,
        label
      )
      let toolbarButtons = app.toolbars.buttons
        .matching(toolbarButtonPredicate)
        .allElementsBoundByIndex
      if let hittable = toolbarButtons.first(where: {
        $0.exists && $0.isHittable && isKeyboardAccessoryControl($0, keyboardFrame: keyboardFrame)
      }) {
        hittable.tap()
        return true
      }
    }
    return false
#endif
  }

  private func isKeyboardAccessoryControl(_ element: XCUIElement, keyboardFrame: CGRect) -> Bool {
    let frame = element.frame
    guard !frame.isEmpty && !keyboardFrame.isEmpty else {
      return false
    }
    return frame.intersects(keyboardFrame) || abs(frame.maxY - keyboardFrame.minY) <= 80
  }

  private func moveCaretToEnd(element: XCUIElement) {
#if os(tvOS)
    return
#else
    let frame = element.frame
    guard !frame.isEmpty else {
      element.tap()
      return
    }
    let origin = element.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let target = origin.withOffset(
      CGVector(dx: max(2, frame.width - 4), dy: max(2, frame.height / 2))
    )
    target.tap()
#endif
  }

  private func estimatedDeleteCount(for element: XCUIElement) -> Int {
    let valueText = String(describing: element.value ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let base = valueText.isEmpty ? 24 : (valueText.count + 8)
    return max(24, min(120, base))
  }

  private func readableText(for element: XCUIElement) -> String? {
    let label = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let identifier = element.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    let valueText = String(describing: element.value ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    switch element.elementType {
    case .textField, .secureTextField, .searchField, .textView:
      if !valueText.isEmpty { return valueText }
      if !label.isEmpty { return label }
      return identifier.isEmpty ? nil : identifier
    default:
      if !label.isEmpty { return label }
      if !valueText.isEmpty { return valueText }
      return identifier.isEmpty ? nil : identifier
    }
  }

  private func prefersExpandedTextRead(_ element: XCUIElement) -> Bool {
    switch element.elementType {
    case .textField, .secureTextField, .searchField, .textView:
      return true
    default:
      return false
    }
  }

  func findScopeElement(app: XCUIApplication, scope: String) -> XCUIElement? {
    let predicate = NSPredicate(
      format: "label CONTAINS[c] %@ OR identifier CONTAINS[c] %@",
      scope,
      scope
    )
    let element = app.descendants(matching: .any).matching(predicate).firstMatch
    return element.exists ? element : nil
  }

  func tapAt(app: XCUIApplication, x: Double, y: Double) -> RunnerInteractionOutcome {
    if let outcome = selectFocusedTvElement(app: app, point: CGPoint(x: x, y: y), action: "tap") {
      return outcome
    }
    return performCoordinateTap(app: app, x: x, y: y)
  }

  func mouseClickAt(app: XCUIApplication, x: Double, y: Double, button: String) throws {
#if os(macOS)
    let coordinate = interactionCoordinate(app: app, x: x, y: y)
    switch button {
    case "primary":
      coordinate.tap()
    case "secondary":
      coordinate.rightClick()
    case "middle":
      throw NSError(
        domain: "AgentDeviceRunner",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "middle mouse button is not supported"]
      )
    default:
      throw NSError(
        domain: "AgentDeviceRunner",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "unsupported mouse button: \(button)"]
      )
    }
#elseif os(tvOS)
    throw NSError(
      domain: "AgentDeviceRunner",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: "mouseClick is not supported on tvOS"]
    )
#else
    throw NSError(
      domain: "AgentDeviceRunner",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: "mouseClick is only supported on macOS"]
    )
#endif
  }

  func doubleTapAt(app: XCUIApplication, x: Double, y: Double) -> RunnerInteractionOutcome {
    if let outcome = selectFocusedTvElement(app: app, point: CGPoint(x: x, y: y), action: "double tap") {
      guard case .performed = outcome else { return outcome }
      sleepFor(0.1)
      _ = pressTvRemote(.select)
      return .performed
    }
    return performCoordinateDoubleTap(app: app, x: x, y: y)
  }

  func longPressAt(app: XCUIApplication, x: Double, y: Double, duration: TimeInterval) -> RunnerInteractionOutcome {
    if let outcome = longSelectFocusedTvElement(app: app, point: CGPoint(x: x, y: y), duration: duration) {
      return outcome
    }
    return performCoordinateLongPress(app: app, x: x, y: y, duration: duration)
  }

  func dragAt(
    app: XCUIApplication,
    x: Double,
    y: Double,
    x2: Double,
    y2: Double,
    holdDuration: TimeInterval
  ) -> RunnerInteractionOutcome {
    // tvOS has no coordinate drag. Preserve the direction as a focus move.
    let dx = x2 - x
    let dy = y2 - y
    let button: TvRemoteButton = abs(dx) > abs(dy)
      ? (dx > 0 ? .right : .left)
      : (dy > 0 ? .down : .up)
    if pressTvRemote(button) {
      return .performed
    }
    return performCoordinateDrag(app: app, x: x, y: y, x2: x2, y2: y2, holdDuration: holdDuration)
  }

  func resolvedTouchVisualizationFrame(app: XCUIApplication, x: Double, y: Double) -> TouchVisualizationFrame {
    let appFrame = app.frame
    let referenceFrame = resolvedTouchReferenceFrame(app: app, appFrame: appFrame)
    let originX = appFrame.isEmpty ? referenceFrame.minX : appFrame.minX
    let originY = appFrame.isEmpty ? referenceFrame.minY : appFrame.minY
    return TouchVisualizationFrame(
      x: originX + x,
      y: originY + y,
      referenceWidth: referenceFrame.width,
      referenceHeight: referenceFrame.height
    )
  }

  func resolvedDragVisualizationFrame(
    app: XCUIApplication,
    x: Double,
    y: Double,
    x2: Double,
    y2: Double
  ) -> DragVisualizationFrame {
    let start = resolvedTouchVisualizationFrame(app: app, x: x, y: y)
    let end = resolvedTouchVisualizationFrame(app: app, x: x2, y: y2)
    return DragVisualizationFrame(
      x: start.x,
      y: start.y,
      x2: end.x,
      y2: end.y,
      referenceWidth: start.referenceWidth,
      referenceHeight: start.referenceHeight
    )
  }

  func resolvedTouchReferenceFrame(app: XCUIApplication, appFrame: CGRect) -> CGRect {
    let window = app.windows.firstMatch
    let windowFrame = window.frame
    if window.exists && !windowFrame.isEmpty {
      return windowFrame
    }
    if !appFrame.isEmpty {
      return appFrame
    }
    return CGRect(x: 0, y: 0, width: 0, height: 0)
  }

  func runSeries(count: Int, pauseMs: Double, operation: (Int) -> Void) {
    let total = max(count, 1)
    let pause = max(pauseMs, 0)
    for idx in 0..<total {
      operation(idx)
      if idx < total - 1 && pause > 0 {
        Thread.sleep(forTimeInterval: pause / 1000.0)
      }
    }
  }

  func swipe(app: XCUIApplication, direction: String) -> DragVisualizationFrame? {
    if performTvRemoteSwipeIfAvailable(direction: direction) {
      let frame = resolvedTouchReferenceFrame(app: app, appFrame: app.frame)
      let midX = frame.midX
      let midY = frame.midY
      return DragVisualizationFrame(
        x: midX,
        y: midY,
        x2: midX,
        y2: midY,
        referenceWidth: frame.width,
        referenceHeight: frame.height
      )
    }
    return nil
  }

  private func performTvRemoteSwipeIfAvailable(direction: String) -> Bool {
    switch direction {
    case "up":
      return pressTvRemote(.up)
    case "down":
      return pressTvRemote(.down)
    case "left":
      return pressTvRemote(.left)
    case "right":
      return pressTvRemote(.right)
    default:
      return false
    }
  }

  func pinch(app: XCUIApplication, scale: Double, x: Double?, y: Double?) -> RunnerInteractionOutcome {
    return performCoordinatePinch(app: app, scale: scale, x: x, y: y)
  }

  private func performCoordinatePinch(app: XCUIApplication, scale: Double, x: Double?, y: Double?) -> RunnerInteractionOutcome {
#if os(tvOS)
    return .unsupported("pinch is not supported on tvOS")
#else
    let target = app.windows.firstMatch.exists ? app.windows.firstMatch : app

    // Use double-tap + drag gesture for reliable map zoom
    // Zoom in (scale > 1): tap then drag UP
    // Zoom out (scale < 1): tap then drag DOWN

    // Determine center point (use provided x/y or screen center)
    let centerX = x.map { $0 / target.frame.width } ?? 0.5
    let centerY = y.map { $0 / target.frame.height } ?? 0.5
    let center = target.coordinate(withNormalizedOffset: CGVector(dx: centerX, dy: centerY))

    // Calculate drag distance based on scale (clamped to reasonable range)
    // Larger scale = more drag distance
    let dragAmount: CGFloat
    if scale > 1.0 {
      // Zoom in: drag up (negative Y direction in normalized coords)
      dragAmount = min(0.4, CGFloat(scale - 1.0) * 0.2)
    } else {
      // Zoom out: drag down (positive Y direction)
      dragAmount = min(0.4, CGFloat(1.0 - scale) * 0.4)
    }

    let endY = scale > 1.0 ? (centerY - Double(dragAmount)) : (centerY + Double(dragAmount))
    let endPoint = target.coordinate(withNormalizedOffset: CGVector(dx: centerX, dy: max(0.1, min(0.9, endY))))

    // Tap first (first tap of double-tap)
    center.tap()

    // Immediately press and drag (second tap + drag)
    center.press(forDuration: 0.05, thenDragTo: endPoint)
    return .performed
#endif
  }

  private func interactionRoot(app: XCUIApplication) -> XCUIElement {
    let windows = app.windows.allElementsBoundByIndex
    if let window = windows.first(where: { $0.exists && !$0.frame.isEmpty }) {
      return window
    }
    return app
  }

  private func performCoordinateTap(app: XCUIApplication, x: Double, y: Double) -> RunnerInteractionOutcome {
#if os(tvOS)
    return .unsupported("coordinate tap is not supported on tvOS; move focus with swipe or scroll, then select the focused element")
#else
    interactionCoordinate(app: app, x: x, y: y).tap()
    return .performed
#endif
  }

  private func performCoordinateDoubleTap(app: XCUIApplication, x: Double, y: Double) -> RunnerInteractionOutcome {
#if os(tvOS)
    return .unsupported("coordinate double tap is not supported on tvOS; move focus with swipe or scroll, then select the focused element")
#else
    interactionCoordinate(app: app, x: x, y: y).doubleTap()
    return .performed
#endif
  }

  private func performCoordinateLongPress(app: XCUIApplication, x: Double, y: Double, duration: TimeInterval) -> RunnerInteractionOutcome {
#if os(tvOS)
    return .unsupported("coordinate long press is not supported on tvOS; move focus with swipe or scroll, then long-select the focused element")
#else
    interactionCoordinate(app: app, x: x, y: y).press(forDuration: duration)
    return .performed
#endif
  }

  private func performCoordinateDrag(
    app: XCUIApplication,
    x: Double,
    y: Double,
    x2: Double,
    y2: Double,
    holdDuration: TimeInterval
  ) -> RunnerInteractionOutcome {
#if os(tvOS)
    return .unsupported("coordinate drag is not supported on tvOS")
#else
    let start = interactionCoordinate(app: app, x: x, y: y)
    let end = interactionCoordinate(app: app, x: x2, y: y2)
    start.press(forDuration: holdDuration, thenDragTo: end)
    return .performed
#endif
  }

#if !os(tvOS)
  private func interactionCoordinate(app: XCUIApplication, x: Double, y: Double) -> XCUICoordinate {
    let root = interactionRoot(app: app)
    let origin = root.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let rootFrame = root.frame
    let offsetX = x - Double(rootFrame.origin.x)
    let offsetY = y - Double(rootFrame.origin.y)
    return origin.withOffset(CGVector(dx: offsetX, dy: offsetY))
  }
#endif

  private func tapElementCenter(app: XCUIApplication, element: XCUIElement) {
    let frame = element.frame
    if !frame.isEmpty {
      _ = tapAt(app: app, x: frame.midX, y: frame.midY)
      return
    }
#if !os(tvOS)
    element.tap()
#endif
  }

  private func macOSNavigationBackElement(app: XCUIApplication) -> XCUIElement? {
    let predicate = NSPredicate(
      format: "identifier == %@ OR label == %@",
      "go back",
      "Back"
    )
    let element = app.descendants(matching: .any).matching(predicate).firstMatch
    return element.exists ? element : nil
  }
}
