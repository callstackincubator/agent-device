import XCTest

extension RunnerTests {
  struct GestureTiming {
    let startUptimeMs: Double
    let endUptimeMs: Double
  }

  // MARK: - Navigation Gestures

  func tapNavigationBack(app: XCUIApplication) -> Bool {
    let buttons = app.navigationBars.buttons.allElementsBoundByIndex
    if let back = buttons.first(where: { $0.isHittable }) {
      back.tap()
      return true
    }
    return pressTvRemoteMenuIfAvailable()
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
    if pressTvRemoteHomeIfAvailable() {
      return
    }
    XCUIDevice.shared.press(.home)
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
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let coordinate = origin.withOffset(CGVector(dx: x, dy: y))
    coordinate.tap()
  }

  func timedTapAt(app: XCUIApplication, x: Double, y: Double) -> GestureTiming {
    measureGestureTiming {
      tapAt(app: app, x: x, y: y)
    }
  }

  func doubleTapAt(app: XCUIApplication, x: Double, y: Double) {
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let coordinate = origin.withOffset(CGVector(dx: x, dy: y))
    coordinate.doubleTap()
  }

  func timedDoubleTapAt(app: XCUIApplication, x: Double, y: Double) -> GestureTiming {
    measureGestureTiming {
      doubleTapAt(app: app, x: x, y: y)
    }
  }

  func longPressAt(app: XCUIApplication, x: Double, y: Double, duration: TimeInterval) {
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let coordinate = origin.withOffset(CGVector(dx: x, dy: y))
    coordinate.press(forDuration: duration)
  }

  func timedLongPressAt(app: XCUIApplication, x: Double, y: Double, duration: TimeInterval) -> GestureTiming {
    measureGestureTiming {
      longPressAt(app: app, x: x, y: y, duration: duration)
    }
  }

  func dragAt(
    app: XCUIApplication,
    x: Double,
    y: Double,
    x2: Double,
    y2: Double,
    holdDuration: TimeInterval
  ) {
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let start = origin.withOffset(CGVector(dx: x, dy: y))
    let end = origin.withOffset(CGVector(dx: x2, dy: y2))
    start.press(forDuration: holdDuration, thenDragTo: end)
  }

  func timedDragAt(
    app: XCUIApplication,
    x: Double,
    y: Double,
    x2: Double,
    y2: Double,
    holdDuration: TimeInterval
  ) -> GestureTiming {
    measureGestureTiming {
      dragAt(app: app, x: x, y: y, x2: x2, y2: y2, holdDuration: holdDuration)
    }
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

  func timedPinch(app: XCUIApplication, scale: Double, x: Double?, y: Double?) -> GestureTiming {
    measureGestureTiming {
      pinch(app: app, scale: scale, x: x, y: y)
    }
  }

  func measureGestureTiming(_ action: () -> Void) -> GestureTiming {
    let start = ProcessInfo.processInfo.systemUptime * 1000
    action()
    let end = ProcessInfo.processInfo.systemUptime * 1000
    return GestureTiming(startUptimeMs: start, endUptimeMs: max(start, end))
  }

}
