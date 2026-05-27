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

  struct DragPoints {
    let x: Double
    let y: Double
    let x2: Double
    let y2: Double
  }

  struct SelectorElementMatch {
    let element: XCUIElement?
    let isAmbiguous: Bool
    let usedNonHittableFallback: Bool
  }

  enum TextTypingRepairMode {
    case none
    case append
    case replacement
  }

  enum TextEntryTiming {
    static let focusTimeout: TimeInterval = 0.4
    static let repairReadinessTimeout: TimeInterval = 1.0
    static let readinessTimeout: TimeInterval = 2.0
    static let hardwareKeyboardFallbackTimeout: TimeInterval = 0.35
    static let pollInterval: TimeInterval = 0.02
    static let warmupValueTimeout: TimeInterval = 0.4
    static let verificationStabilityWindow: TimeInterval = 0.2
  }

  struct TextEntryResult {
    let verified: Bool?
    let repaired: Bool
    let expectedText: String?
    let observedText: String?
  }

  struct TextEntryTarget {
    let element: XCUIElement?
    let refreshPoint: CGPoint?
    let prefersFocusedElement: Bool

    func withElement(_ nextElement: XCUIElement?) -> TextEntryTarget {
      guard let nextElement else {
        return self
      }
      let frame = nextElement.frame
      let point = frame.isEmpty ? refreshPoint : CGPoint(x: frame.midX, y: frame.midY)
      return TextEntryTarget(
        element: nextElement,
        refreshPoint: point,
        prefersFocusedElement: prefersFocusedElement
      )
    }
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

  func findElement(
    app: XCUIApplication,
    selectorKey: String,
    selectorValue: String,
    allowNonHittableFallback: Bool = false
  ) -> SelectorElementMatch {
    let value = selectorValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else {
      return SelectorElementMatch(element: nil, isAmbiguous: false, usedNonHittableFallback: false)
    }
    let predicate: NSPredicate
    switch selectorKey {
    case "id":
      predicate = NSPredicate(format: "identifier ==[c] %@", value)
    case "label":
      predicate = NSPredicate(format: "label ==[c] %@", value)
    case "value":
      predicate = NSPredicate(format: "value ==[c] %@", value)
    case "text":
      predicate = NSPredicate(format: "label ==[c] %@ OR identifier ==[c] %@ OR value ==[c] %@", value, value, value)
    default:
      return SelectorElementMatch(element: nil, isAmbiguous: false, usedNonHittableFallback: false)
    }

    var matchedElement: XCUIElement?
    var nonHittableElement: XCUIElement?
    let matches = app.descendants(matching: .any).matching(predicate).allElementsBoundByIndex
    for element in matches where element.exists {
      if !element.isHittable {
        if allowNonHittableFallback && hasTappableFrame(app: app, element: element) {
          guard nonHittableElement == nil else {
            return SelectorElementMatch(element: nil, isAmbiguous: true, usedNonHittableFallback: false)
          }
          nonHittableElement = element
        }
        continue
      }
      guard matchedElement == nil else {
        return SelectorElementMatch(element: nil, isAmbiguous: true, usedNonHittableFallback: false)
      }
      matchedElement = element
    }
    if let matchedElement {
      return SelectorElementMatch(element: matchedElement, isAmbiguous: false, usedNonHittableFallback: false)
    }
    return SelectorElementMatch(
      element: nonHittableElement,
      isAmbiguous: false,
      usedNonHittableFallback: nonHittableElement != nil
    )
  }

  private func hasTappableFrame(app: XCUIApplication, element: XCUIElement) -> Bool {
    let frame = element.frame
    if frame.isEmpty {
      return false
    }
    let appFrame = app.frame
    if appFrame.isEmpty {
      return true
    }
    return appFrame.contains(CGPoint(x: frame.midX, y: frame.midY))
  }

  func queryElement(app: XCUIApplication, selectorKey: String, selectorValue: String) -> Response {
    let match = findElement(app: app, selectorKey: selectorKey, selectorValue: selectorValue)
    if match.isAmbiguous {
      return Response(ok: false, error: ErrorPayload(code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements"))
    }
    guard let element = match.element else {
      return Response(ok: true, data: DataPayload(found: false, nodes: []))
    }

    let label = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let identifier = element.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    let valueText = String(describing: element.value ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let node = SnapshotNode(
      index: 0,
      type: elementTypeName(element.elementType),
      label: label.isEmpty ? nil : label,
      identifier: identifier.isEmpty ? nil : identifier,
      value: valueText.isEmpty ? nil : valueText,
      rect: snapshotRect(from: element.frame),
      enabled: element.isEnabled,
      focused: nil,
      selected: element.isSelected ? true : nil,
      hittable: element.isHittable,
      depth: 0,
      parentIndex: nil,
      hiddenContentAbove: nil,
      hiddenContentBelow: nil
    )
    return Response(
      ok: true,
      data: DataPayload(
        text: readableText(for: element),
        found: true,
        nodes: [node]
      )
    )
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
            return !frame.isEmpty && frameContainsPoint(frame, point, tolerance: 2)
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

  private func frameContainsPoint(_ frame: CGRect, _ point: CGPoint, tolerance: CGFloat) -> Bool {
    point.x >= frame.minX - tolerance
      && point.x <= frame.maxX + tolerance
      && point.y >= frame.minY - tolerance
      && point.y <= frame.maxY + tolerance
  }

  func focusedTextInput(app: XCUIApplication) -> XCUIElement? {
#if os(iOS)
    // iOS focus predicates can return stale or misleading text-input matches
    // under XCUITest, so text entry readiness is driven by tap/keyboard state.
    return nil
#else
    var focused: XCUIElement?
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      let candidates = app
        .descendants(matching: .any)
        .matching(NSPredicate(format: "hasKeyboardFocus == 1"))
        .allElementsBoundByIndex
      for candidate in candidates where candidate.exists {
        switch candidate.elementType {
        case .textField, .secureTextField, .searchField, .textView:
          focused = candidate
          return
        default:
          continue
        }
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
#endif
  }

  func stabilizeTextInputBeforeTyping(app: XCUIApplication, target: XCUIElement?) -> XCUIElement? {
#if os(tvOS)
    return target
#else
    let latest = target
    let deadline = Date().addingTimeInterval(TextEntryTiming.focusTimeout)
    while Date() < deadline {
      if let focused = focusedTextInput(app: app) {
        return focused
      }
      sleepFor(TextEntryTiming.pollInterval)
    }
    return latest
#endif
  }

  func focusTextInputForTextEntry(app: XCUIApplication, x: Double?, y: Double?) -> TextEntryTarget {
    guard let x, let y else {
      let focused = waitForTextEntryReadiness(
        app: app,
        target: TextEntryTarget(
          element: focusedTextInput(app: app),
          refreshPoint: nil,
          prefersFocusedElement: true
        )
      )
      return TextEntryTarget(element: focused, refreshPoint: nil, prefersFocusedElement: true)
    }

    let target = textInputAt(app: app, x: x, y: y)
    let requestedPoint = CGPoint(x: x, y: y)
    if let target {
      let frame = target.frame
      if !frame.isEmpty {
        _ = tapAt(app: app, x: frame.midX, y: frame.midY)
      } else {
        _ = tapAt(app: app, x: x, y: y)
      }
    } else {
      _ = tapAt(app: app, x: x, y: y)
    }
    let stabilized = stabilizeTextInputBeforeTyping(app: app, target: target)
    let element = waitForTextEntryReadiness(
      app: app,
      target: TextEntryTarget(
        element: stabilized ?? target,
        refreshPoint: requestedPoint,
        prefersFocusedElement: false
      )
    ) ?? stabilized ?? target
    return TextEntryTarget(
      element: element,
      refreshPoint: textEntryRefreshPoint(for: element) ?? requestedPoint,
      prefersFocusedElement: false
    )
  }

  func focusTextInputForTextEntry(app: XCUIApplication, element: XCUIElement) -> TextEntryTarget {
    let point = textEntryRefreshPoint(for: element)
    if let point {
      _ = tapAt(app: app, x: point.x, y: point.y)
    }
    let stabilized = stabilizeTextInputBeforeTyping(app: app, target: element)
    let resolved = waitForTextEntryReadiness(
      app: app,
      target: TextEntryTarget(
        element: stabilized ?? element,
        refreshPoint: point,
        prefersFocusedElement: false
      )
    ) ?? stabilized ?? element
    return TextEntryTarget(
      element: resolved,
      refreshPoint: textEntryRefreshPoint(for: resolved) ?? point,
      prefersFocusedElement: false
    )
  }

  func isTextEntryElement(_ element: XCUIElement) -> Bool {
    switch element.elementType {
    case .textField, .secureTextField, .searchField, .textView:
      return true
    default:
      return false
    }
  }

  func resolveTextEntryMode(_ command: Command) -> TextTypingRepairMode {
    switch command.textEntryMode {
    case "append":
      return .append
    case "replace":
      return .replacement
    default:
      return command.clearFirst == true ? .replacement : .none
    }
  }

  func typeTextReliably(
    app: XCUIApplication,
    target: TextEntryTarget,
    text: String,
    delaySeconds: Double,
    repairMode: TextTypingRepairMode = .none
  ) -> TextEntryResult {
    guard !text.isEmpty else {
      return TextEntryResult(verified: true, repaired: false, expectedText: "", observedText: "")
    }
    var activeTarget = target
    let initialTarget = resolveTextEntryElement(app: app, target: activeTarget)
    activeTarget = activeTarget.withElement(initialTarget)
    let currentText = editableTextValue(for: initialTarget, treatingPlaceholderAsEmpty: true)
    let initialText = repairMode == .append ? currentText : nil
    let expectedText = expectedTextEntryValue(typedText: text, mode: repairMode, initialText: initialText)

    if repairMode == .replacement {
      guard let replacementTarget = initialTarget else {
        return TextEntryResult(verified: nil, repaired: false, expectedText: expectedText, observedText: nil)
      }
      if currentText == nil || currentText?.isEmpty == false {
        clearTextInput(replacementTarget)
        activeTarget = activeTarget.withElement(replacementTarget)
      }
    }

    func typeIntoCurrentTarget(_ value: String) -> XCUIElement? {
      if let currentTarget = resolveTextEntryElement(app: app, target: activeTarget) {
        app.typeText(value)
        return currentTarget
      } else {
        app.typeText(value)
        return resolveTextEntryElement(app: app, target: activeTarget)
      }
    }

    func waitForWarmupValue(_ expectedValue: String?, target: TextEntryTarget) {
      guard let expectedValue else {
        sleepFor(TextEntryTiming.pollInterval)
        return
      }
      let deadline = Date().addingTimeInterval(TextEntryTiming.warmupValueTimeout)
      while Date() < deadline {
        if editableTextValue(for: resolveTextEntryElement(app: app, target: target)) == expectedValue {
          return
        }
        sleepFor(TextEntryTiming.pollInterval)
      }
    }

    let characters = Array(text)
    if delaySeconds > 0 && characters.count > 1 {
      var typedTarget: XCUIElement?
      for (index, character) in characters.enumerated() {
        typedTarget = typeIntoCurrentTarget(String(character)) ?? typedTarget
        if index + 1 < characters.count {
          sleepFor(delaySeconds)
        }
      }
      if repairMode == .none {
        return TextEntryResult(verified: nil, repaired: false, expectedText: nil, observedText: nil)
      }
      let repairResult = repairTextEntryIfNeeded(
        app: app,
        target: activeTarget.withElement(typedTarget),
        expectedText: expectedText,
        repairMode: repairMode
      )
      return verifyTextEntry(
        app: app,
        target: activeTarget.withElement(typedTarget),
        expectedText: expectedText,
        repaired: repairResult.repaired
      )
    }

    let typedTarget: XCUIElement?
    if repairMode != .none && characters.count > 1 {
      let firstCharacter = String(characters[0])
      var firstTypedTarget = typeIntoCurrentTarget(firstCharacter)
      activeTarget = activeTarget.withElement(firstTypedTarget)
      let warmupExpectedText = expectedTextEntryValue(
        typedText: firstCharacter,
        mode: repairMode,
        initialText: initialText
      )
      waitForWarmupValue(warmupExpectedText, target: activeTarget)
      let remainingText = String(characters.dropFirst())
      firstTypedTarget = typeIntoCurrentTarget(remainingText) ?? firstTypedTarget
      typedTarget = firstTypedTarget
    } else {
      typedTarget = typeIntoCurrentTarget(text)
    }
    if repairMode == .none {
      return TextEntryResult(verified: nil, repaired: false, expectedText: nil, observedText: nil)
    }
    let repairResult = repairTextEntryIfNeeded(
      app: app,
      target: activeTarget.withElement(typedTarget),
      expectedText: expectedText,
      repairMode: repairMode
    )
    return verifyTextEntry(
      app: app,
      target: activeTarget.withElement(typedTarget),
      expectedText: expectedText,
      repaired: repairResult.repaired
    )
  }

  private func repairTextEntryIfNeeded(
    app: XCUIApplication,
    target: TextEntryTarget,
    expectedText: String?,
    repairMode: TextTypingRepairMode
  ) -> TextEntryResult {
#if os(iOS)
    guard let targetElement = resolveTextEntryElement(app: app, target: target) else {
      return TextEntryResult(verified: nil, repaired: false, expectedText: expectedText, observedText: nil)
    }
    guard let expectedText else {
      let observedText = editableTextValue(for: targetElement)
      return TextEntryResult(verified: nil, repaired: false, expectedText: nil, observedText: observedText)
    }
    guard shouldRepairTextEntry(
      app: app,
      target: target,
      expectedText: expectedText,
      repairMode: repairMode
    ) else {
      return verifyTextEntry(app: app, target: target, expectedText: expectedText, repaired: false)
    }

    guard let repairTarget = resolveTextEntryElement(app: app, target: target) else {
      return TextEntryResult(verified: nil, repaired: false, expectedText: expectedText, observedText: nil)
    }
    let observedText = editableTextValue(for: repairTarget) ?? ""
    NSLog(
      "AGENT_DEVICE_RUNNER_REPAIR_TEXT_ENTRY expectedLength=%d observedLength=%d",
      expectedText.count,
      observedText.count
    )
    clearTextInput(repairTarget)
    app.typeText(expectedText)
    return verifyTextEntry(app: app, target: target, expectedText: expectedText, repaired: true)
#else
    return TextEntryResult(verified: nil, repaired: false, expectedText: expectedText, observedText: nil)
#endif
  }

  private func verifyTextEntry(
    app: XCUIApplication,
    target: TextEntryTarget,
    expectedText: String?,
    repaired: Bool
  ) -> TextEntryResult {
    let targetElement = resolveTextEntryElement(app: app, target: target)
    guard let expectedText else {
      return TextEntryResult(
        verified: nil,
        repaired: repaired,
        expectedText: nil,
        observedText: editableTextValue(for: targetElement)
      )
    }
    guard let observedText = editableTextValue(for: targetElement) else {
      return TextEntryResult(verified: nil, repaired: repaired, expectedText: expectedText, observedText: nil)
    }
    guard textEntryValueMatchesExpected(targetElement, observedText: observedText, expectedText: expectedText) else {
      return TextEntryResult(
        verified: false,
        repaired: repaired,
        expectedText: expectedText,
        observedText: observedText
      )
    }
    let stableDeadline = Date().addingTimeInterval(TextEntryTiming.verificationStabilityWindow)
    var latestObservedText = observedText
    while Date() < stableDeadline {
      sleepFor(TextEntryTiming.pollInterval)
      guard let nextObservedText = editableTextValue(for: resolveTextEntryElement(app: app, target: target)) else {
        return TextEntryResult(verified: nil, repaired: repaired, expectedText: expectedText, observedText: nil)
      }
      latestObservedText = nextObservedText
      guard textEntryValueMatchesExpected(
        resolveTextEntryElement(app: app, target: target),
        observedText: nextObservedText,
        expectedText: expectedText
      ) else {
        return TextEntryResult(
          verified: false,
          repaired: repaired,
          expectedText: expectedText,
          observedText: nextObservedText
        )
      }
    }
    return TextEntryResult(
      verified: true,
      repaired: repaired,
      expectedText: expectedText,
      observedText: latestObservedText
    )
  }

  private func textEntryValueMatchesExpected(
    _ element: XCUIElement?,
    observedText: String,
    expectedText: String
  ) -> Bool {
    if observedText == expectedText {
      return true
    }
    guard hasTextEntrySubmitSuffix(expectedText), element?.elementType != .textView else {
      return false
    }
    var submittedText = expectedText
    while hasTextEntrySubmitSuffix(submittedText) {
      submittedText.removeLast()
    }
    return observedText == submittedText
  }

  private func hasTextEntrySubmitSuffix(_ text: String) -> Bool {
    text.hasSuffix("\n") || text.hasSuffix("\r")
  }

  private func expectedTextEntryValue(
    typedText: String,
    mode: TextTypingRepairMode,
    initialText: String?
  ) -> String? {
    switch mode {
    case .none:
      return nil
    case .append:
      guard let initialText else {
        return nil
      }
      return initialText + typedText
    case .replacement:
      return typedText
    }
  }

  private func shouldRepairTextEntry(
    app: XCUIApplication,
    target: TextEntryTarget,
    expectedText: String,
    repairMode: TextTypingRepairMode
  ) -> Bool {
#if os(iOS)
    var latestObservedText: String?
    let deadline = Date().addingTimeInterval(TextEntryTiming.verificationStabilityWindow)
    repeat {
      guard let observedText = editableTextValue(for: resolveTextEntryElement(app: app, target: target)) else {
        return false
      }
      if textEntryValueMatchesExpected(
        resolveTextEntryElement(app: app, target: target),
        observedText: observedText,
        expectedText: expectedText
      ) {
        return false
      }
      latestObservedText = observedText
      if !isRepairableTextEntryMismatch(
        observedText: observedText,
        expectedText: expectedText,
        repairMode: repairMode
      ) {
        return false
      }
      sleepFor(TextEntryTiming.pollInterval)
    } while Date() < deadline

    guard let latestObservedText else {
      return false
    }
    guard !textEntryValueMatchesExpected(
      resolveTextEntryElement(app: app, target: target),
      observedText: latestObservedText,
      expectedText: expectedText
    ) else {
      return false
    }
    return isRepairableTextEntryMismatch(
      observedText: latestObservedText,
      expectedText: expectedText,
      repairMode: repairMode
    )
#else
    return false
#endif
  }

  private func isRepairableTextEntryMismatch(
    observedText: String,
    expectedText: String,
    repairMode: TextTypingRepairMode
  ) -> Bool {
    guard observedText != expectedText else {
      return false
    }
    if repairMode == .replacement {
      return true
    }
    return observedText.isEmpty || isLikelyDroppedCharacterTextEntryMismatch(
      observedText: observedText,
      expectedText: expectedText
    )
  }

  private func isLikelyDroppedCharacterTextEntryMismatch(observedText: String, expectedText: String) -> Bool {
    guard observedText.count < expectedText.count else {
      return false
    }
    let missingCharacterCount = expectedText.count - observedText.count
    guard missingCharacterCount <= max(2, expectedText.count / 4) else {
      return false
    }
    var expectedIndex = expectedText.startIndex
    for character in observedText {
      guard let matchIndex = expectedText[expectedIndex...].firstIndex(of: character) else {
        return false
      }
      expectedIndex = expectedText.index(after: matchIndex)
    }
    return true
  }

  private func resolveTextEntryElement(app: XCUIApplication, target: TextEntryTarget) -> XCUIElement? {
    if target.prefersFocusedElement {
      if let focused = focusedTextInput(app: app) {
        return focused
      }
      if let element = target.element, element.exists {
        return element
      }
    } else {
      if let element = target.element, element.exists {
        return element
      }
    }
    if let refreshPoint = target.refreshPoint,
       let refreshed = textInputAt(app: app, x: refreshPoint.x, y: refreshPoint.y) {
      return refreshed
    }
    if let focused = focusedTextInput(app: app) {
      return focused
    }
    return nil
  }

  private func waitForTextEntryReadiness(
    app: XCUIApplication,
    target: TextEntryTarget,
    timeout: TimeInterval = TextEntryTiming.readinessTimeout
  ) -> XCUIElement? {
#if os(iOS)
    var latest = resolveTextEntryElement(app: app, target: target)
    let deadline = Date().addingTimeInterval(timeout)
    let hardwareKeyboardFallback = Date().addingTimeInterval(
      min(TextEntryTiming.hardwareKeyboardFallbackTimeout, timeout)
    )
    var sawSoftwareKeyboard = false
    while Date() < deadline {
      if let focused = focusedTextInput(app: app) {
        latest = focused
        if isKeyboardVisible(app: app) {
          return focused
        }
      }
      sawSoftwareKeyboard = sawSoftwareKeyboard || keyboardElementExists(app: app)
      if !sawSoftwareKeyboard && Date() >= hardwareKeyboardFallback && latest != nil {
        return latest
      }
      sleepFor(TextEntryTiming.pollInterval)
    }
    return focusedTextInput(app: app) ?? latest
#else
    return resolveTextEntryElement(app: app, target: target)
#endif
  }

  func waitForTextEntryReadinessAfterTap(app: XCUIApplication, element: XCUIElement) {
#if os(iOS)
    switch element.elementType {
    case .textField, .secureTextField, .searchField, .textView:
      if waitForFocusedTextInput(app: app, timeout: TextEntryTiming.readinessTimeout) != nil {
        return
      }
      let frame = element.frame
      if !frame.isEmpty {
        _ = tapAt(app: app, x: frame.midX, y: frame.midY)
        _ = waitForFocusedTextInput(app: app, timeout: TextEntryTiming.readinessTimeout)
      }
    default:
      return
    }
#endif
  }

  private func waitForFocusedTextInput(app: XCUIApplication, timeout: TimeInterval) -> XCUIElement? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if let focused = focusedTextInput(app: app) {
        return focused
      }
      sleepFor(TextEntryTiming.pollInterval)
    }
    return focusedTextInput(app: app)
  }

  private func textEntryRefreshPoint(for element: XCUIElement?) -> CGPoint? {
    guard let element else {
      return nil
    }
    let frame = element.frame
    guard !frame.isEmpty else {
      return nil
    }
    return CGPoint(x: frame.midX, y: frame.midY)
  }

  func isKeyboardVisible(app: XCUIApplication) -> Bool {
    return visibleKeyboardFrame(app: app) != nil
  }

  private func keyboardElementExists(app: XCUIApplication) -> Bool {
#if os(iOS)
    var exists = false
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      exists = app.keyboards.firstMatch.exists
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_KEYBOARD_EXISTS_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return false
    }
    return exists
#else
    return false
#endif
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

  func pressKeyboardReturn(app: XCUIApplication) -> (wasVisible: Bool, pressed: Bool, visible: Bool) {
#if os(tvOS)
    return (wasVisible: false, pressed: pressTvRemote(.select), visible: false)
#elseif os(iOS)
    let wasVisible = isKeyboardVisible(app: app)
    if tapKeyboardReturnControl(app: app) {
      sleepFor(0.2)
      return (wasVisible: wasVisible, pressed: true, visible: isKeyboardVisible(app: app))
    }

    var typed = false
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      app.typeText(XCUIKeyboardKey.return.rawValue)
      typed = true
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_KEYBOARD_RETURN_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      if let singleTarget = singleTextEntryElement(app: app) {
        return pressKeyboardReturn(on: singleTarget, app: app, wasVisible: wasVisible)
      }
      return (wasVisible: wasVisible, pressed: false, visible: isKeyboardVisible(app: app))
    }
    sleepFor(0.2)
    return (wasVisible: wasVisible, pressed: typed, visible: isKeyboardVisible(app: app))
#else
    return (wasVisible: false, pressed: false, visible: false)
#endif
  }

  private func pressKeyboardReturn(
    on element: XCUIElement,
    app: XCUIApplication,
    wasVisible: Bool
  ) -> (wasVisible: Bool, pressed: Bool, visible: Bool) {
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      element.tap()
      element.typeText(XCUIKeyboardKey.return.rawValue)
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_KEYBOARD_RETURN_TARGET_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return (wasVisible: wasVisible, pressed: false, visible: isKeyboardVisible(app: app))
    }
    sleepFor(0.2)
    return (wasVisible: wasVisible, pressed: true, visible: isKeyboardVisible(app: app))
  }

  private func singleTextEntryElement(app: XCUIApplication) -> XCUIElement? {
#if os(iOS)
    var matches: [XCUIElement] = []
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      matches = app.descendants(matching: .any).allElementsBoundByIndex.filter { element in
        guard element.exists else { return false }
        switch element.elementType {
        case .textField, .secureTextField, .searchField, .textView:
          return true
        default:
          return false
        }
      }
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_KEYBOARD_RETURN_TEXT_ENTRY_QUERY_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return nil
    }
    return matches.count == 1 ? matches[0] : nil
#else
    return nil
#endif
  }

  private func tapKeyboardDismissControl(app: XCUIApplication) -> Bool {
#if os(tvOS)
    return false
#else
    guard let keyboardFrame = visibleKeyboardFrame(app: app) else {
      return false
    }
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

  private func tapKeyboardReturnControl(app: XCUIApplication) -> Bool {
#if os(iOS)
    for label in ["return", "Return", "Enter", "Go", "Search", "Next", "Done", "Send", "Join"] {
      let candidates = [
        app.keyboards.buttons[label],
        app.keyboards.keys[label],
      ]
      if let hittable = candidates.first(where: { $0.exists && $0.isHittable }) {
        hittable.tap()
        return true
      }
    }
#endif
    return false
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
    let valueText = normalizedElementText(element.value)
    let base = valueText.isEmpty ? 24 : (valueText.count + 8)
    return max(24, min(120, base))
  }

  private func normalizedElementText(_ value: Any?) -> String {
    String(describing: value ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func editableTextValue(
    for element: XCUIElement?,
    treatingPlaceholderAsEmpty: Bool = false
  ) -> String? {
    guard let element else {
      return nil
    }
    switch element.elementType {
    case .textField, .searchField, .textView:
      let value = String(describing: element.value ?? "")
      if treatingPlaceholderAsEmpty && isPlaceholderValue(value, for: element) {
        return ""
      }
      return value
    case .secureTextField:
      return nil
    default:
      return nil
    }
  }

  private func isPlaceholderValue(_ value: String, for element: XCUIElement) -> Bool {
    let normalizedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedValue.isEmpty else {
      return false
    }
    let placeholder = element.placeholderValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !placeholder.isEmpty && normalizedValue == placeholder {
      return true
    }
    if isGenericTextInputLabel(normalizedValue) {
      return true
    }
    let normalizedLabel = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
    return normalizedLabel == normalizedValue && isGenericTextInputLabel(normalizedLabel)
  }

  private func isGenericTextInputLabel(_ value: String) -> Bool {
    switch value {
    case "Text input field":
      return true
    default:
      return false
    }
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

  func keyboardAvoidingDragPoints(
    app: XCUIApplication,
    x: Double,
    y: Double,
    x2: Double,
    y2: Double
  ) -> DragPoints {
    let original = DragPoints(x: x, y: y, x2: x2, y2: y2)
#if os(iOS)
    guard let keyboardFrame = visibleKeyboardFrame(app: app) else {
      return original
    }
    let minX = min(x, x2)
    let minY = min(y, y2)
    let gestureBounds = CGRect(
      x: CGFloat(minX),
      y: CGFloat(minY),
      width: CGFloat(max(abs(x2 - x), 1)),
      height: CGFloat(max(abs(y2 - y), 1))
    )
    guard gestureBounds.intersects(keyboardFrame) else {
      return original
    }

    let window = app.windows.firstMatch
    let appFrame = window.exists && !window.frame.isEmpty ? window.frame : app.frame
    guard !appFrame.isEmpty else {
      return original
    }

    let padding: Double = 12
    let targetMaxY = Double(keyboardFrame.minY) - padding
    let currentMaxY = max(y, y2)
    let shift = currentMaxY - targetMaxY
    guard shift > 0 else {
      return original
    }

    let adjustedY = y - shift
    let adjustedY2 = y2 - shift
    guard min(adjustedY, adjustedY2) >= Double(appFrame.minY) + padding else {
      return original
    }

    NSLog(
      "AGENT_DEVICE_RUNNER_KEYBOARD_AVOIDING_DRAG from=(%.1f,%.1f)->(%.1f,%.1f) adjusted=(%.1f,%.1f)->(%.1f,%.1f) keyboardMinY=%.1f",
      x,
      y,
      x2,
      y2,
      x,
      adjustedY,
      x2,
      adjustedY2,
      Double(keyboardFrame.minY)
    )
    return DragPoints(x: x, y: adjustedY, x2: x2, y2: adjustedY2)
#else
    return original
#endif
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
    if window.exists {
      let windowFrame = window.frame
      if !windowFrame.isEmpty {
        return frameAvoidingKeyboard(app: app, frame: windowFrame)
      }
    }
    if !appFrame.isEmpty {
      return frameAvoidingKeyboard(app: app, frame: appFrame)
    }
    return CGRect(x: 0, y: 0, width: 0, height: 0)
  }

  private func frameAvoidingKeyboard(app: XCUIApplication, frame: CGRect) -> CGRect {
#if os(iOS)
    guard let keyboardFrame = visibleKeyboardFrame(app: app), !frame.isEmpty else {
      return frame
    }
    let intersection = frame.intersection(keyboardFrame)
    guard !intersection.isNull && intersection.height > 0 else {
      return frame
    }
    let keyboardCoverage = intersection.width / max(frame.width, 1)
    guard keyboardCoverage >= 0.5 else {
      return frame
    }
    let safeHeight = keyboardFrame.minY - frame.minY
    guard safeHeight >= frame.height * 0.25 else {
      return frame
    }
    return CGRect(x: frame.minX, y: frame.minY, width: frame.width, height: safeHeight)
#else
    return frame
#endif
  }

  private func visibleKeyboardFrame(app: XCUIApplication) -> CGRect? {
#if os(iOS)
    var frame: CGRect?
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      let keyboard = app.keyboards.firstMatch
      guard keyboard.exists else { return }
      let keyboardFrame = keyboard.frame
      guard !keyboardFrame.isEmpty else { return }
      frame = keyboardFrame
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_KEYBOARD_FRAME_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return nil
    }
    return frame
#else
    return nil
#endif
  }

  func runSeries(count: Int, pauseMs: Double, operation: (Int) -> Void) {
    let total = max(count, 1)
    let pause = max(pauseMs, 0)
    for idx in 0..<total {
      operation(idx)
      if idx < total - 1 && pause > 0 {
        sleepFor(pause / 1000.0)
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

  func rotateGesture(app: XCUIApplication, degrees: Double, x: Double?, y: Double?, velocity: Double) -> RunnerInteractionOutcome {
    return performCoordinateRotateGesture(app: app, degrees: degrees, x: x, y: y, velocity: velocity)
  }

  func transformGesture(
    app: XCUIApplication,
    x: Double,
    y: Double,
    dx: Double,
    dy: Double,
    scale: Double,
    degrees: Double,
    durationMs: Double
  ) -> RunnerInteractionOutcome {
#if os(iOS)
    let target = interactionRoot(app: app)
    if let message = RunnerSynthesizedGesture.synthesizeTransform(
      withApplication: app,
      x: x,
      y: y,
      dx: dx,
      dy: dy,
      scale: scale,
      degrees: degrees,
      radius: transformGestureRadius(frame: target.frame, scale: scale),
      durationMs: durationMs
    ) {
      return .unsupported(message)
    }
    return .performed
#elseif os(tvOS)
    return .unsupported("transformGesture is not supported on tvOS")
#else
    return .unsupported("transformGesture is not supported on macOS")
#endif
  }

  private func transformGestureRadius(frame: CGRect, scale: Double) -> Double {
    let shorterSide = Double(min(frame.width, frame.height))
    let frameRadius = shorterSide * 0.20
    let minimumEndRadius = shorterSide * 0.08
    let scaleAdjustedRadius = scale < 1.0 ? max(frameRadius, minimumEndRadius / scale) : frameRadius
    return min(max(scaleAdjustedRadius, 48.0), shorterSide * 0.35)
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

  private func performCoordinateRotateGesture(app: XCUIApplication, degrees: Double, x: Double?, y: Double?, velocity: Double) -> RunnerInteractionOutcome {
#if os(iOS)
    let target = app.windows.firstMatch.exists ? app.windows.firstMatch : app
    let radians = CGFloat(degrees * .pi / 180.0)
    target.rotate(radians, withVelocity: CGFloat(velocity))
    return .performed
#elseif os(tvOS)
    return .unsupported("rotate-gesture is not supported on tvOS")
#else
    return .unsupported("rotate-gesture is not supported on macOS")
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
#if os(iOS)
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    return origin.withOffset(CGVector(dx: x, dy: y))
#else
    let root = interactionRoot(app: app)
    let origin = root.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let rootFrame = root.frame
    let offsetX = x - Double(rootFrame.origin.x)
    let offsetY = y - Double(rootFrame.origin.y)
    return origin.withOffset(CGVector(dx: offsetX, dy: offsetY))
#endif
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
