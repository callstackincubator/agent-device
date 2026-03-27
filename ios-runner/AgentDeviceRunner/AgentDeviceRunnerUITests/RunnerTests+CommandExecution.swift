import XCTest

extension RunnerTests {
  // MARK: - Main Thread Dispatch

  private func currentUptimeMs() -> Double {
    ProcessInfo.processInfo.systemUptime * 1000
  }

  private func measureGesture(_ action: () -> Void) -> (gestureStartUptimeMs: Double, gestureEndUptimeMs: Double) {
    let gestureStartUptimeMs = currentUptimeMs()
    action()
    return (gestureStartUptimeMs, currentUptimeMs())
  }

  func execute(command: Command) throws -> Response {
    if Thread.isMainThread {
      return try executeOnMainSafely(command: command)
    }
    var result: Result<Response, Error>?
    let semaphore = DispatchSemaphore(value: 0)
    DispatchQueue.main.async {
      do {
        result = .success(try self.executeOnMainSafely(command: command))
      } catch {
        result = .failure(error)
      }
      semaphore.signal()
    }
    let waitResult = semaphore.wait(timeout: .now() + mainThreadExecutionTimeout)
    if waitResult == .timedOut {
      // The main queue work may still be running; we stop waiting and report timeout.
      throw NSError(
        domain: RunnerErrorDomain.general,
        code: RunnerErrorCode.mainThreadExecutionTimedOut,
        userInfo: [NSLocalizedDescriptionKey: "main thread execution timed out"]
      )
    }
    switch result {
    case .success(let response):
      return response
    case .failure(let error):
      throw error
    case .none:
      throw NSError(
        domain: RunnerErrorDomain.general,
        code: RunnerErrorCode.noResponseFromMainThread,
        userInfo: [NSLocalizedDescriptionKey: "no response from main thread"]
      )
    }
  }

  // MARK: - Command Handling

  private func executeOnMainSafely(command: Command) throws -> Response {
    var hasRetried = false
    while true {
      var response: Response?
      var swiftError: Error?
      let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
        do {
          response = try self.executeOnMain(command: command)
        } catch {
          swiftError = error
        }
      })

      if let exceptionMessage {
        currentApp = nil
        currentBundleId = nil
        if !hasRetried, shouldRetryException(command, message: exceptionMessage) {
          NSLog(
            "AGENT_DEVICE_RUNNER_RETRY command=%@ reason=objc_exception",
            command.command.rawValue
          )
          hasRetried = true
          sleepFor(retryCooldown)
          continue
        }
        throw NSError(
          domain: RunnerErrorDomain.exception,
          code: RunnerErrorCode.objcException,
          userInfo: [NSLocalizedDescriptionKey: exceptionMessage]
        )
      }
      if let swiftError {
        throw swiftError
      }
      guard let response else {
        throw NSError(
          domain: RunnerErrorDomain.general,
          code: RunnerErrorCode.commandReturnedNoResponse,
          userInfo: [NSLocalizedDescriptionKey: "command returned no response"]
        )
      }
      if !hasRetried, shouldRetryCommand(command), shouldRetryResponse(response) {
        NSLog(
          "AGENT_DEVICE_RUNNER_RETRY command=%@ reason=response_unavailable",
          command.command.rawValue
        )
        hasRetried = true
        currentApp = nil
        currentBundleId = nil
        sleepFor(retryCooldown)
        continue
      }
      return response
    }
  }

  private func executeOnMain(command: Command) throws -> Response {
    var activeApp = currentApp ?? app
    if !isRunnerLifecycleCommand(command.command) {
      let normalizedBundleId = command.appBundleId?
        .trimmingCharacters(in: .whitespacesAndNewlines)
      let requestedBundleId = (normalizedBundleId?.isEmpty == true) ? nil : normalizedBundleId
      if let bundleId = requestedBundleId {
        if currentBundleId != bundleId || currentApp == nil {
          _ = activateTarget(bundleId: bundleId, reason: "bundle_changed")
        }
      } else {
        // Do not reuse stale bundle targets when the caller does not explicitly request one.
        currentApp = nil
        currentBundleId = nil
      }

      activeApp = currentApp ?? app
      if let bundleId = requestedBundleId, targetNeedsActivation(activeApp) {
        activeApp = activateTarget(bundleId: bundleId, reason: "stale_target")
      } else if requestedBundleId == nil, targetNeedsActivation(activeApp) {
        app.activate()
        activeApp = app
      }

      if !activeApp.waitForExistence(timeout: appExistenceTimeout) {
        if let bundleId = requestedBundleId {
          activeApp = activateTarget(bundleId: bundleId, reason: "missing_after_wait")
          guard activeApp.waitForExistence(timeout: appExistenceTimeout) else {
            return Response(ok: false, error: ErrorPayload(message: "app '\(bundleId)' is not available"))
          }
        } else {
          return Response(ok: false, error: ErrorPayload(message: "runner app is not available"))
        }
      }

      if isInteractionCommand(command.command) {
        if let bundleId = requestedBundleId, activeApp.state != .runningForeground {
          activeApp = activateTarget(bundleId: bundleId, reason: "interaction_foreground_guard")
        } else if requestedBundleId == nil, activeApp.state != .runningForeground {
          app.activate()
          activeApp = app
        }
        if !activeApp.waitForExistence(timeout: 2) {
          if let bundleId = requestedBundleId {
            return Response(ok: false, error: ErrorPayload(message: "app '\(bundleId)' is not available"))
          }
          return Response(ok: false, error: ErrorPayload(message: "runner app is not available"))
        }
        applyInteractionStabilizationIfNeeded()
      }
    }

    switch command.command {
    case .shutdown:
      stopRecordingIfNeeded()
      return Response(ok: true, data: DataPayload(message: "shutdown"))
    case .recordStart:
      guard
        let requestedOutPath = command.outPath?.trimmingCharacters(in: .whitespacesAndNewlines),
        !requestedOutPath.isEmpty
      else {
        return Response(ok: false, error: ErrorPayload(message: "recordStart requires outPath"))
      }
      let hasAppBundleId = !(command.appBundleId?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .isEmpty ?? true)
      guard hasAppBundleId else {
        return Response(ok: false, error: ErrorPayload(message: "recordStart requires appBundleId"))
      }
      if activeRecording != nil {
        return Response(ok: false, error: ErrorPayload(message: "recording already in progress"))
      }
      if let requestedFps = command.fps, (requestedFps < minRecordingFps || requestedFps > maxRecordingFps) {
        return Response(ok: false, error: ErrorPayload(message: "recordStart fps must be between \(minRecordingFps) and \(maxRecordingFps)"))
      }
      do {
        let resolvedOutPath = resolveRecordingOutPath(requestedOutPath)
        let fpsLabel = command.fps.map(String.init) ?? String(RunnerTests.defaultRecordingFps)
        NSLog(
          "AGENT_DEVICE_RUNNER_RECORD_START requestedOutPath=%@ resolvedOutPath=%@ fps=%@",
          requestedOutPath,
          resolvedOutPath,
          fpsLabel
        )
        let recorder = ScreenRecorder(outputPath: resolvedOutPath, fps: command.fps.map { Int32($0) })
        try recorder.start { [weak self] in
          return self?.captureRunnerFrame()
        }
        activeRecording = recorder
        return Response(ok: true, data: DataPayload(message: "recording started"))
      } catch {
        activeRecording = nil
        return Response(ok: false, error: ErrorPayload(message: "failed to start recording: \(error.localizedDescription)"))
      }
    case .recordStop:
      guard let recorder = activeRecording else {
        return Response(ok: false, error: ErrorPayload(message: "no active recording"))
      }
      do {
        try recorder.stop()
        activeRecording = nil
        return Response(ok: true, data: DataPayload(message: "recording stopped"))
      } catch {
        activeRecording = nil
        return Response(ok: false, error: ErrorPayload(message: "failed to stop recording: \(error.localizedDescription)"))
      }
    case .uptime:
      return Response(
        ok: true,
        data: DataPayload(currentUptimeMs: currentUptimeMs())
      )
    case .tap:
      if let text = command.text {
        if let element = findElement(app: activeApp, text: text) {
          let timing = measureGesture {
            withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
              element.tap()
            }
          }
          return Response(
            ok: true,
            data: DataPayload(
              message: "tapped",
              gestureStartUptimeMs: timing.gestureStartUptimeMs,
              gestureEndUptimeMs: timing.gestureEndUptimeMs
            )
          )
        }
        return Response(ok: false, error: ErrorPayload(message: "element not found"))
      }
      if let x = command.x, let y = command.y {
        let touchFrame = resolvedTouchVisualizationFrame(app: activeApp, x: x, y: y)
        let timing = measureGesture {
          withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
            tapAt(app: activeApp, x: x, y: y)
          }
        }
        return Response(
          ok: true,
          data: DataPayload(
            message: "tapped",
            gestureStartUptimeMs: timing.gestureStartUptimeMs,
            gestureEndUptimeMs: timing.gestureEndUptimeMs,
            x: touchFrame.x,
            y: touchFrame.y,
            referenceWidth: touchFrame.referenceWidth,
            referenceHeight: touchFrame.referenceHeight
          )
        )
      }
      return Response(ok: false, error: ErrorPayload(message: "tap requires text or x/y"))
    case .mouseClick:
      guard let x = command.x, let y = command.y else {
        return Response(ok: false, error: ErrorPayload(message: "mouseClick requires x and y"))
      }
      let touchFrame = resolvedTouchVisualizationFrame(app: activeApp, x: x, y: y)
      do {
        var clickError: Error?
        let timing = measureGesture {
          do {
            try mouseClickAt(app: activeApp, x: x, y: y, button: command.button ?? "primary")
          } catch {
            clickError = error
          }
        }
        if let clickError {
          throw clickError
        }
        return Response(
          ok: true,
          data: DataPayload(
            message: "clicked",
            gestureStartUptimeMs: timing.gestureStartUptimeMs,
            gestureEndUptimeMs: timing.gestureEndUptimeMs,
            x: touchFrame.x,
            y: touchFrame.y,
            referenceWidth: touchFrame.referenceWidth,
            referenceHeight: touchFrame.referenceHeight
          )
        )
      } catch {
        return Response(ok: false, error: ErrorPayload(message: error.localizedDescription))
      }
    case .tapSeries:
      guard let x = command.x, let y = command.y else {
        return Response(ok: false, error: ErrorPayload(message: "tapSeries requires x and y"))
      }
      let count = max(Int(command.count ?? 1), 1)
      let intervalMs = max(command.intervalMs ?? 0, 0)
      let doubleTap = command.doubleTap ?? false
      let touchFrame = resolvedTouchVisualizationFrame(app: activeApp, x: x, y: y)
      if doubleTap {
        let timing = measureGesture {
          withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
            runSeries(count: count, pauseMs: intervalMs) { _ in
              doubleTapAt(app: activeApp, x: x, y: y)
            }
          }
        }
        return Response(
          ok: true,
          data: DataPayload(
            message: "tap series",
            gestureStartUptimeMs: timing.gestureStartUptimeMs,
            gestureEndUptimeMs: timing.gestureEndUptimeMs,
            x: touchFrame.x,
            y: touchFrame.y,
            referenceWidth: touchFrame.referenceWidth,
            referenceHeight: touchFrame.referenceHeight
          )
        )
      }
      let timing = measureGesture {
        withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
          runSeries(count: count, pauseMs: intervalMs) { _ in
            tapAt(app: activeApp, x: x, y: y)
          }
        }
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "tap series",
          gestureStartUptimeMs: timing.gestureStartUptimeMs,
          gestureEndUptimeMs: timing.gestureEndUptimeMs,
          x: touchFrame.x,
          y: touchFrame.y,
          referenceWidth: touchFrame.referenceWidth,
          referenceHeight: touchFrame.referenceHeight
        )
      )
    case .longPress:
      guard let x = command.x, let y = command.y else {
        return Response(ok: false, error: ErrorPayload(message: "longPress requires x and y"))
      }
      let duration = (command.durationMs ?? 800) / 1000.0
      let touchFrame = resolvedTouchVisualizationFrame(app: activeApp, x: x, y: y)
      let timing = measureGesture {
        withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
          longPressAt(app: activeApp, x: x, y: y, duration: duration)
        }
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "long pressed",
          gestureStartUptimeMs: timing.gestureStartUptimeMs,
          gestureEndUptimeMs: timing.gestureEndUptimeMs,
          x: touchFrame.x,
          y: touchFrame.y,
          referenceWidth: touchFrame.referenceWidth,
          referenceHeight: touchFrame.referenceHeight
        )
      )
    case .drag:
      guard let x = command.x, let y = command.y, let x2 = command.x2, let y2 = command.y2 else {
        return Response(ok: false, error: ErrorPayload(message: "drag requires x, y, x2, and y2"))
      }
      let holdDuration = min(max((command.durationMs ?? 60) / 1000.0, 0.016), 10.0)
      let dragFrame = resolvedDragVisualizationFrame(app: activeApp, x: x, y: y, x2: x2, y2: y2)
      let timing = measureGesture {
        withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
          dragAt(app: activeApp, x: x, y: y, x2: x2, y2: y2, holdDuration: holdDuration)
        }
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "dragged",
          gestureStartUptimeMs: timing.gestureStartUptimeMs,
          gestureEndUptimeMs: timing.gestureEndUptimeMs,
          x: dragFrame.x,
          y: dragFrame.y,
          x2: dragFrame.x2,
          y2: dragFrame.y2,
          referenceWidth: dragFrame.referenceWidth,
          referenceHeight: dragFrame.referenceHeight
        )
      )
    case .dragSeries:
      guard let x = command.x, let y = command.y, let x2 = command.x2, let y2 = command.y2 else {
        return Response(ok: false, error: ErrorPayload(message: "dragSeries requires x, y, x2, and y2"))
      }
      let count = max(Int(command.count ?? 1), 1)
      let pauseMs = max(command.pauseMs ?? 0, 0)
      let pattern = command.pattern ?? "one-way"
      if pattern != "one-way" && pattern != "ping-pong" {
        return Response(ok: false, error: ErrorPayload(message: "dragSeries pattern must be one-way or ping-pong"))
      }
      let holdDuration = min(max((command.durationMs ?? 60) / 1000.0, 0.016), 10.0)
      let timing = measureGesture {
        withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
          runSeries(count: count, pauseMs: pauseMs) { idx in
            let reverse = pattern == "ping-pong" && (idx % 2 == 1)
            if reverse {
              dragAt(app: activeApp, x: x2, y: y2, x2: x, y2: y, holdDuration: holdDuration)
            } else {
              dragAt(app: activeApp, x: x, y: y, x2: x2, y2: y2, holdDuration: holdDuration)
            }
          }
        }
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "drag series",
          gestureStartUptimeMs: timing.gestureStartUptimeMs,
          gestureEndUptimeMs: timing.gestureEndUptimeMs
        )
      )
    case .type:
      guard let text = command.text else {
        return Response(ok: false, error: ErrorPayload(message: "type requires text"))
      }
      let delaySeconds = Double(max(command.delayMs ?? 0, 0)) / 1000.0
      let target = focusedTextInput(app: activeApp)
      func typeIntoTarget(_ value: String) {
        if let focused = target {
          focused.typeText(value)
        } else {
          activeApp.typeText(value)
        }
      }
      if command.clearFirst == true {
        guard let focused = target else {
          return Response(ok: false, error: ErrorPayload(message: "no focused text input to clear"))
        }
        clearTextInput(focused)
      }
      if delaySeconds > 0 && text.count > 1 {
        let chunks = Array(text)
        for (index, character) in chunks.enumerated() {
          typeIntoTarget(String(character))
          if index + 1 < chunks.count {
            Thread.sleep(forTimeInterval: delaySeconds)
          }
        }
      } else {
        typeIntoTarget(text)
      }
      return Response(ok: true, data: DataPayload(message: "typed"))
    case .swipe:
      guard let direction = command.direction else {
        return Response(ok: false, error: ErrorPayload(message: "swipe requires direction"))
      }
      var executedFrame: DragVisualizationFrame?
      let timing = measureGesture {
        withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
          executedFrame = swipe(
            app: activeApp,
            direction: direction,
            amount: command.amount,
            pixels: command.pixels
          )
        }
      }
      guard let dragFrame = executedFrame else {
        return Response(ok: false, error: ErrorPayload(message: "swipe did not produce a gesture frame"))
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "swiped",
          gestureStartUptimeMs: timing.gestureStartUptimeMs,
          gestureEndUptimeMs: timing.gestureEndUptimeMs,
          x: dragFrame.x,
          y: dragFrame.y,
          x2: dragFrame.x2,
          y2: dragFrame.y2,
          referenceWidth: dragFrame.referenceWidth,
          referenceHeight: dragFrame.referenceHeight
        )
      )
    case .findText:
      guard let text = command.text else {
        return Response(ok: false, error: ErrorPayload(message: "findText requires text"))
      }
      let found = findElement(app: activeApp, text: text) != nil
      return Response(ok: true, data: DataPayload(found: found))
    case .readText:
      guard let x = command.x, let y = command.y else {
        return Response(ok: false, error: ErrorPayload(message: "readText requires x and y"))
      }
      guard let text = readTextAt(app: activeApp, x: x, y: y) else {
        return Response(ok: false, error: ErrorPayload(message: "readText did not resolve text"))
      }
      return Response(ok: true, data: DataPayload(text: text))
    case .snapshot:
      let options = SnapshotOptions(
        interactiveOnly: command.interactiveOnly ?? false,
        compact: command.compact ?? false,
        depth: command.depth,
        scope: command.scope,
        raw: command.raw ?? false
      )
      if options.raw {
        needsPostSnapshotInteractionDelay = true
        return Response(ok: true, data: snapshotRaw(app: activeApp, options: options))
      }
      needsPostSnapshotInteractionDelay = true
      return Response(ok: true, data: snapshotFast(app: activeApp, options: options))
    case .screenshot:
      // If a target app bundle ID is provided, activate it first so the screenshot
      // captures the target app rather than the AgentDeviceRunner itself.
      if let bundleId = command.appBundleId, !bundleId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        let targetApp = XCUIApplication(bundleIdentifier: bundleId)
        targetApp.activate()
        // Brief wait for the app transition animation to complete
        Thread.sleep(forTimeInterval: 0.5)
      }
      let screenshot = XCUIScreen.main.screenshot()
      guard let pngData = runnerPngData(for: screenshot.image) else {
        return Response(ok: false, error: ErrorPayload(message: "Failed to encode screenshot as PNG"))
      }
      let fileName = "screenshot-\(Int(Date().timeIntervalSince1970 * 1000)).png"
      let filePath = (NSTemporaryDirectory() as NSString).appendingPathComponent(fileName)
      do {
        try pngData.write(to: URL(fileURLWithPath: filePath))
      } catch {
        return Response(ok: false, error: ErrorPayload(message: "Failed to write screenshot: \(error.localizedDescription)"))
      }
#if os(macOS)
      return Response(ok: true, data: DataPayload(message: filePath))
#else
      // Return path relative to app container root (tmp/ maps to NSTemporaryDirectory)
      return Response(ok: true, data: DataPayload(message: "tmp/\(fileName)"))
#endif
    case .back, .backInApp:
      if tapInAppBackControl(app: activeApp) {
        let message = command.command == .back ? "back" : "backInApp"
        return Response(ok: true, data: DataPayload(message: message))
      }
      return Response(ok: false, error: ErrorPayload(message: "in-app back control is not available"))
    case .backSystem:
      if performSystemBackAction(app: activeApp) {
        return Response(ok: true, data: DataPayload(message: "backSystem"))
      }
      return Response(ok: false, error: ErrorPayload(message: "system back is not available"))
    case .home:
      pressHomeButton()
      return Response(ok: true, data: DataPayload(message: "home"))
    case .appSwitcher:
      performAppSwitcherGesture(app: activeApp)
      return Response(ok: true, data: DataPayload(message: "appSwitcher"))
    case .keyboardDismiss:
      let result = dismissKeyboard(app: activeApp)
      if result.wasVisible && !result.dismissed {
        return Response(
          ok: false,
          error: ErrorPayload(
            code: "UNSUPPORTED_OPERATION",
            message: "Unable to dismiss the iOS keyboard without a native dismiss gesture or control"
          )
        )
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "keyboardDismiss",
          visible: result.visible,
          wasVisible: result.wasVisible,
          dismissed: result.dismissed
        )
      )
    case .alert:
      let action = (command.action ?? "get").lowercased()
      let alert = activeApp.alerts.firstMatch
      if !alert.exists {
        return Response(ok: false, error: ErrorPayload(message: "alert not found"))
      }
      if action == "accept" {
        let button = alert.buttons.allElementsBoundByIndex.first
        button?.tap()
        return Response(ok: true, data: DataPayload(message: "accepted"))
      }
      if action == "dismiss" {
        let button = alert.buttons.allElementsBoundByIndex.last
        button?.tap()
        return Response(ok: true, data: DataPayload(message: "dismissed"))
      }
      let buttonLabels = alert.buttons.allElementsBoundByIndex.map { $0.label }
      return Response(ok: true, data: DataPayload(message: alert.label, items: buttonLabels))
    case .pinch:
      guard let scale = command.scale, scale > 0 else {
        return Response(ok: false, error: ErrorPayload(message: "pinch requires scale > 0"))
      }
      let timing = measureGesture {
        pinch(app: activeApp, scale: scale, x: command.x, y: command.y)
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "pinched",
          gestureStartUptimeMs: timing.gestureStartUptimeMs,
          gestureEndUptimeMs: timing.gestureEndUptimeMs
        )
      )
    }
  }
}
