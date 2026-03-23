import XCTest

extension RunnerTests {
  // MARK: - Navigation Gestures

  func tapNavigationBack(app: XCUIApplication) -> Bool {
#if os(macOS)
    if let back = macOSNavigationBackElement(app: app) {
      tapElementCenter(app: app, element: back)
      return true
    }
    return false
#else
    let buttons = app.navigationBars.buttons.allElementsBoundByIndex
    if let back = buttons.first(where: { $0.isHittable }) {
      back.tap()
      return true
    }
    return pressTvRemoteMenuIfAvailable()
#endif
  }

  func performBackGesture(app: XCUIApplication) {
    if pressTvRemoteMenuIfAvailable() {
      return
    }
    let target = app.windows.firstMatch.exists ? app.windows.firstMatch : app
    let start = target.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5))
    let end = target.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
    start.press(forDuration: 0.05, thenDragTo: end)
  }

  func performAppSwitcherGesture(app: XCUIApplication) {
    if performTvRemoteAppSwitcherIfAvailable() {
      return
    }
    let target = app.windows.firstMatch.exists ? app.windows.firstMatch : app
    let start = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99))
    let end = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
    start.press(forDuration: 0.6, thenDragTo: end)
  }

  func pressHomeButton() {
#if os(macOS)
    return
#else
    if pressTvRemoteHomeIfAvailable() {
      return
    }
    XCUIDevice.shared.press(.home)
#endif
  }

  private func pressTvRemoteMenuIfAvailable() -> Bool {
#if os(tvOS)
    XCUIRemote.shared.press(.menu)
    return true
#else
    return false
#endif
  }

  private func pressTvRemoteHomeIfAvailable() -> Bool {
#if os(tvOS)
    XCUIRemote.shared.press(.home)
    return true
#else
    return false
#endif
  }

  private func performTvRemoteAppSwitcherIfAvailable() -> Bool {
#if os(tvOS)
    XCUIRemote.shared.press(.home)
    sleepFor(resolveTvRemoteDoublePressDelay())
    XCUIRemote.shared.press(.home)
    return true
#else
    return false
#endif
  }

  private func resolveTvRemoteDoublePressDelay() -> TimeInterval {
    guard
      let raw = ProcessInfo.processInfo.environment["AGENT_DEVICE_TV_REMOTE_DOUBLE_PRESS_DELAY_MS"],
      !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return tvRemoteDoublePressDelayDefault
    }
    guard let parsedMs = Double(raw), parsedMs >= 0 else {
      return tvRemoteDoublePressDelayDefault
    }
    return min(parsedMs, 1000) / 1000.0
  }

  func findElement(app: XCUIApplication, text: String) -> XCUIElement? {
    let predicate = NSPredicate(format: "label CONTAINS[c] %@ OR identifier CONTAINS[c] %@ OR value CONTAINS[c] %@", text, text, text)
    let element = app.descendants(matching: .any).matching(predicate).firstMatch
    return element.exists ? element : nil
  }

  func clearTextInput(_ element: XCUIElement) {
    moveCaretToEnd(element: element)
    let count = estimatedDeleteCount(for: element)
    let deletes = String(repeating: XCUIKeyboardKey.delete.rawValue, count: count)
    element.typeText(deletes)
  }

  func focusedTextInput(app: XCUIApplication) -> XCUIElement? {
    let focused = app
      .descendants(matching: .any)
      .matching(NSPredicate(format: "hasKeyboardFocus == 1"))
      .firstMatch
    guard focused.exists else { return nil }

    switch focused.elementType {
    case .textField, .secureTextField, .searchField, .textView:
      return focused
    default:
      return nil
    }
  }

  private func moveCaretToEnd(element: XCUIElement) {
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
  }

  private func estimatedDeleteCount(for element: XCUIElement) -> Int {
    let valueText = String(describing: element.value ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let base = valueText.isEmpty ? 24 : (valueText.count + 8)
    return max(24, min(120, base))
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

  func tapAt(app: XCUIApplication, x: Double, y: Double) {
    let coordinate = interactionCoordinate(app: app, x: x, y: y)
    coordinate.tap()
  }

  func mouseClickAt(app: XCUIApplication, x: Double, y: Double, button: String) throws {
    let coordinate = interactionCoordinate(app: app, x: x, y: y)
    #if os(macOS)
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
    #else
      throw NSError(
        domain: "AgentDeviceRunner",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "mouseClick is only supported on macOS"]
      )
    #endif
  }

  func doubleTapAt(app: XCUIApplication, x: Double, y: Double) {
    let coordinate = interactionCoordinate(app: app, x: x, y: y)
    coordinate.doubleTap()
  }

  func longPressAt(app: XCUIApplication, x: Double, y: Double, duration: TimeInterval) {
    let coordinate = interactionCoordinate(app: app, x: x, y: y)
    coordinate.press(forDuration: duration)
  }

  func dragAt(
    app: XCUIApplication,
    x: Double,
    y: Double,
    x2: Double,
    y2: Double,
    holdDuration: TimeInterval
  ) {
    let start = interactionCoordinate(app: app, x: x, y: y)
    let end = interactionCoordinate(app: app, x: x2, y: y2)
    start.press(forDuration: holdDuration, thenDragTo: end)
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

  func swipe(app: XCUIApplication, direction: SwipeDirection) {
    if performTvRemoteSwipeIfAvailable(direction: direction) {
      return
    }
    let target = app.windows.firstMatch.exists ? app.windows.firstMatch : app
    let start = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
    let end = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
    let left = target.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5))
    let right = target.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))

    switch direction {
    case .up:
      end.press(forDuration: 0.1, thenDragTo: start)
    case .down:
      start.press(forDuration: 0.1, thenDragTo: end)
    case .left:
      right.press(forDuration: 0.1, thenDragTo: left)
    case .right:
      left.press(forDuration: 0.1, thenDragTo: right)
    }
  }

  private func performTvRemoteSwipeIfAvailable(direction: SwipeDirection) -> Bool {
#if os(tvOS)
    switch direction {
    case .up:
      XCUIRemote.shared.press(.up)
    case .down:
      XCUIRemote.shared.press(.down)
    case .left:
      XCUIRemote.shared.press(.left)
    case .right:
      XCUIRemote.shared.press(.right)
    }
    return true
#else
    return false
#endif
  }

  func pinch(app: XCUIApplication, scale: Double, x: Double?, y: Double?) {
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
  }

  private func interactionRoot(app: XCUIApplication) -> XCUIElement {
    let windows = app.windows.allElementsBoundByIndex
    if let window = windows.first(where: { $0.exists && !$0.frame.isEmpty }) {
      return window
    }
    return app
  }

  private func interactionCoordinate(app: XCUIApplication, x: Double, y: Double) -> XCUICoordinate {
    let root = interactionRoot(app: app)
    let origin = root.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let rootFrame = root.frame
    let offsetX = x - Double(rootFrame.origin.x)
    let offsetY = y - Double(rootFrame.origin.y)
    return origin.withOffset(CGVector(dx: offsetX, dy: offsetY))
  }

  private func tapElementCenter(app: XCUIApplication, element: XCUIElement) {
    let frame = element.frame
    if !frame.isEmpty {
      tapAt(app: app, x: frame.midX, y: frame.midY)
      return
    }
    element.tap()
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
