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

  func unsupportedResponse(for outcome: RunnerInteractionOutcome) -> Response? {
    switch outcome {
    case .performed:
      return nil
    case .unsupported(let message, let hint):
      return Response(
        ok: false,
        error: ErrorPayload(code: "UNSUPPORTED_OPERATION", message: message, hint: hint)
      )
    }
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
        ensureRunnerHostAppActive(reason: "missing_app_bundle")
        activeApp = app
      }

      let skipExistenceWait = canUseFastForegroundAppGuard(
        activeApp: activeApp,
        requestedBundleId: requestedBundleId,
        command: command.command
      )
      if !skipExistenceWait && !activeApp.waitForExistence(timeout: appExistenceTimeout) {
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
          ensureRunnerHostAppActive(reason: "interaction_missing_app_bundle")
          activeApp = app
        }
        let skipInteractionExistenceWait = canUseFastForegroundAppGuard(
          activeApp: activeApp,
          requestedBundleId: requestedBundleId,
          command: command.command
        )
        if !skipInteractionExistenceWait && !activeApp.waitForExistence(timeout: 2) {
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
      if let requestedQuality = command.quality, (requestedQuality < minRecordingQuality || requestedQuality > maxRecordingQuality) {
        return Response(ok: false, error: ErrorPayload(message: "recordStart quality must be between \(minRecordingQuality) and \(maxRecordingQuality)"))
      }
      do {
        let resolvedOutPath = resolveRecordingOutPath(requestedOutPath)
        let fpsLabel = command.fps.map(String.init) ?? String(RunnerTests.defaultRecordingFps)
        let qualityLabel = command.quality.map(String.init) ?? "native"
        NSLog(
          "AGENT_DEVICE_RUNNER_RECORD_START requestedOutPath=%@ resolvedOutPath=%@ fps=%@ quality=%@",
          requestedOutPath,
          resolvedOutPath,
          fpsLabel,
          qualityLabel
        )
        let recorder = ScreenRecorder(
          outputPath: resolvedOutPath,
          fps: command.fps.map { Int32($0) },
          quality: command.quality
        )
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
      if let selectorKey = command.selectorKey, let selectorValue = command.selectorValue {
        let match = findElement(
          app: activeApp,
          selectorKey: selectorKey,
          selectorValue: selectorValue,
          allowNonHittableFallback: command.allowNonHittableCoordinateFallback == true
        )
        if match.isAmbiguous {
          return Response(ok: false, error: ErrorPayload(code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements"))
        }
        if let element = match.element {
          let frame = element.frame
          let touchFrame = frame.isEmpty
            ? nil
            : resolvedTouchVisualizationFrame(app: activeApp, x: frame.midX, y: frame.midY)
          var outcome = RunnerInteractionOutcome.performed
          let timing = measureGesture {
            withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
              if match.usedNonHittableFallback {
                // Maestro compatibility: RN E2E backdoor controls can be 1x1 and
                // reported non-hittable by XCTest, while Maestro still taps their
                // resolved bounds. Keep this behind the explicit replay-only flag.
                outcome = tapAt(app: activeApp, x: frame.midX, y: frame.midY)
              } else {
                outcome = activateElement(app: activeApp, element: element, action: "tap by selector")
              }
            }
          }
          if let response = unsupportedResponse(for: outcome) {
            return response
          }
          waitForTextEntryReadinessAfterTap(app: activeApp, element: element)
          return Response(
            ok: true,
            data: DataPayload(
              message: match.usedNonHittableFallback ? "tapped via non-hittable coordinate fallback" : "tapped",
              gestureStartUptimeMs: timing.gestureStartUptimeMs,
              gestureEndUptimeMs: timing.gestureEndUptimeMs,
              x: touchFrame?.x,
              y: touchFrame?.y,
              referenceWidth: touchFrame?.referenceWidth,
              referenceHeight: touchFrame?.referenceHeight
            )
          )
        }
        return Response(ok: false, error: ErrorPayload(code: "ELEMENT_NOT_FOUND", message: "element not found"))
      }
      if let text = command.text {
        if let element = findElement(app: activeApp, text: text) {
          var outcome = RunnerInteractionOutcome.performed
          let timing = measureGesture {
            withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
              outcome = activateElement(app: activeApp, element: element, action: "tap by text")
            }
          }
          if let response = unsupportedResponse(for: outcome) {
            return response
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
        var outcome = RunnerInteractionOutcome.performed
        let timing = measureGesture {
          withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
            outcome = tapAt(app: activeApp, x: x, y: y)
          }
        }
        if let response = unsupportedResponse(for: outcome) {
          return response
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
        var outcome = RunnerInteractionOutcome.performed
        let timing = measureGesture {
          withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
            runSeries(count: count, pauseMs: intervalMs) { _ in
              if case .performed = outcome {
                outcome = doubleTapAt(app: activeApp, x: x, y: y)
              }
            }
          }
        }
        if let response = unsupportedResponse(for: outcome) {
          return response
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
      var outcome = RunnerInteractionOutcome.performed
      let timing = measureGesture {
        withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
          runSeries(count: count, pauseMs: intervalMs) { _ in
            if case .performed = outcome {
              outcome = tapAt(app: activeApp, x: x, y: y)
            }
          }
        }
      }
      if let response = unsupportedResponse(for: outcome) {
        return response
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
      var outcome = RunnerInteractionOutcome.performed
      let timing = measureGesture {
        withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
          outcome = longPressAt(app: activeApp, x: x, y: y, duration: duration)
        }
      }
      if let response = unsupportedResponse(for: outcome) {
        return response
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
      let dragPoints = keyboardAvoidingDragPoints(app: activeApp, x: x, y: y, x2: x2, y2: y2)
      let dragFrame = resolvedDragVisualizationFrame(
        app: activeApp,
        x: dragPoints.x,
        y: dragPoints.y,
        x2: dragPoints.x2,
        y2: dragPoints.y2
      )
      var outcome = RunnerInteractionOutcome.performed
      let timing = measureGesture {
        withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
          outcome = dragAt(
            app: activeApp,
            x: dragPoints.x,
            y: dragPoints.y,
            x2: dragPoints.x2,
            y2: dragPoints.y2,
            holdDuration: holdDuration
          )
        }
      }
      if let response = unsupportedResponse(for: outcome) {
        return response
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
      let dragPoints = keyboardAvoidingDragPoints(app: activeApp, x: x, y: y, x2: x2, y2: y2)
      var outcome = RunnerInteractionOutcome.performed
      let timing = measureGesture {
        withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
          runSeries(count: count, pauseMs: pauseMs) { idx in
            guard case .performed = outcome else {
              return
            }
            let reverse = pattern == "ping-pong" && (idx % 2 == 1)
            if reverse {
              outcome = dragAt(
                app: activeApp,
                x: dragPoints.x2,
                y: dragPoints.y2,
                x2: dragPoints.x,
                y2: dragPoints.y,
                holdDuration: holdDuration
              )
            } else {
              outcome = dragAt(
                app: activeApp,
                x: dragPoints.x,
                y: dragPoints.y,
                x2: dragPoints.x2,
                y2: dragPoints.y2,
                holdDuration: holdDuration
              )
            }
          }
        }
      }
      if let response = unsupportedResponse(for: outcome) {
        return response
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "drag series",
          gestureStartUptimeMs: timing.gestureStartUptimeMs,
          gestureEndUptimeMs: timing.gestureEndUptimeMs
        )
      )
    case .remotePress:
      guard let button = tvRemoteButton(from: command.remoteButton) else {
        return Response(ok: false, error: ErrorPayload(message: "remotePress requires remoteButton"))
      }
      let duration = (command.durationMs ?? 0) / 1000.0
      guard pressTvRemote(button, duration: duration) else {
        return Response(
          ok: false,
          error: ErrorPayload(code: "UNSUPPORTED_OPERATION", message: "remotePress is only supported on tvOS")
        )
      }
      return Response(ok: true, data: DataPayload(message: "remote pressed"))
    case .type:
      var response: Response?
      withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
        response = executeTypeCommand(activeApp: activeApp, command: command)
      }
      return response ?? Response(ok: false, error: ErrorPayload(message: "type produced no response"))
    case .interactionFrame:
      let frame = resolvedTouchReferenceFrame(app: activeApp, appFrame: activeApp.frame)
      return Response(
        ok: true,
        data: DataPayload(
          x: frame.minX,
          y: frame.minY,
          referenceWidth: frame.width,
          referenceHeight: frame.height
        )
      )
    case .swipe:
      guard let direction = command.direction else {
        return Response(ok: false, error: ErrorPayload(message: "swipe requires direction"))
      }
      var executedFrame: DragVisualizationFrame?
      let timing = measureGesture {
        withTemporaryScrollIdleTimeoutIfSupported(activeApp) {
          executedFrame = swipe(
            app: activeApp,
            direction: direction
          )
        }
      }
      guard let dragFrame = executedFrame else {
        return Response(ok: false, error: ErrorPayload(message: "swipe is only supported on tvOS"))
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
    case .querySelector:
      guard let selectorKey = command.selectorKey, let selectorValue = command.selectorValue else {
        return Response(ok: false, error: ErrorPayload(message: "querySelector requires selectorKey and selectorValue"))
      }
      return queryElement(app: activeApp, selectorKey: selectorKey, selectorValue: selectorValue)
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
      do {
        let payload: DataPayload
        if options.raw {
          payload = try snapshotRaw(app: activeApp, options: options)
        } else {
          payload = try snapshotFast(app: activeApp, options: options)
        }
        needsPostSnapshotInteractionDelay = true
        return Response(ok: true, data: payload)
      } catch let failure as SnapshotCaptureFailure {
        // Other thrown errors fall through to executeOnMainSafely's generic error response.
        return Response(
          ok: false,
          error: ErrorPayload(
            code: failure.code,
            message: failure.message,
            hint: failure.hint
          )
        )
      }
    case .screenshot:
      let screenshot: XCUIScreenshot
#if os(macOS)
      // macOS keeps the app-targeted capture behavior for window-level screenshots.
      if let bundleId = command.appBundleId, !bundleId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        let targetApp = XCUIApplication(bundleIdentifier: bundleId)
        targetApp.activate()
        activeApp = targetApp
        // Brief wait for the app transition animation to complete
        sleepFor(0.5)
      }
      if command.fullscreen == true {
        screenshot = XCUIScreen.main.screenshot()
      } else if let bundleId = command.appBundleId, !bundleId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        screenshot = screenshotRoot(app: activeApp).screenshot()
      } else {
        screenshot = XCUIScreen.main.screenshot()
      }
#else
      screenshot = XCUIScreen.main.screenshot()
#endif
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
    case .rotate:
      guard let orientation = command.orientation?.trimmingCharacters(in: .whitespacesAndNewlines),
        !orientation.isEmpty
      else {
        return Response(ok: false, error: ErrorPayload(message: "rotate requires orientation"))
      }
      if rotateDevice(to: orientation) {
        return Response(
          ok: true,
          data: DataPayload(message: "rotate", orientation: orientation)
        )
      }
      return Response(
        ok: false,
        error: ErrorPayload(message: "unsupported rotate orientation: \(orientation)")
      )
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
    case .keyboardReturn:
      let result = pressKeyboardReturn(app: activeApp)
      if !result.pressed {
        return Response(
          ok: false,
          error: ErrorPayload(
            code: "UNSUPPORTED_OPERATION",
            message: "Unable to press the iOS keyboard return key"
          )
        )
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "keyboardReturn",
          visible: result.visible,
          wasVisible: result.wasVisible
        )
      )
    case .alert:
      let action = (command.action ?? "get").lowercased()
      guard let alert = resolveAlert(app: activeApp) else {
        return Response(ok: false, error: ErrorPayload(message: "alert not found"))
      }
      return handleAlert(alert, action: action)
    case .pinch:
      guard let scale = command.scale, scale > 0 else {
        return Response(ok: false, error: ErrorPayload(message: "pinch requires scale > 0"))
      }
      var outcome = RunnerInteractionOutcome.performed
      let timing = measureGesture {
        outcome = pinch(app: activeApp, scale: scale, x: command.x, y: command.y)
      }
      if let response = unsupportedResponse(for: outcome) {
        return response
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "pinched",
          gestureStartUptimeMs: timing.gestureStartUptimeMs,
          gestureEndUptimeMs: timing.gestureEndUptimeMs
        )
      )
    case .rotateGesture:
      guard let degrees = command.degrees, degrees.isFinite else {
        return Response(ok: false, error: ErrorPayload(message: "rotateGesture requires degrees"))
      }
      let velocity = command.velocity ?? (degrees >= 0 ? 1.0 : -1.0)
      guard velocity.isFinite && velocity != 0 else {
        return Response(ok: false, error: ErrorPayload(message: "rotateGesture velocity must be non-zero"))
      }
      var outcome = RunnerInteractionOutcome.performed
      let timing = measureGesture {
        outcome = rotateGesture(
          app: activeApp,
          degrees: degrees,
          x: command.x,
          y: command.y,
          velocity: velocity
        )
      }
      if let response = unsupportedResponse(for: outcome) {
        return response
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "rotatedGesture",
          gestureStartUptimeMs: timing.gestureStartUptimeMs,
          gestureEndUptimeMs: timing.gestureEndUptimeMs
        )
      )
    case .transformGesture:
      guard
        let x = command.x,
        let y = command.y,
        let dx = command.dx,
        let dy = command.dy,
        x.isFinite,
        y.isFinite,
        dx.isFinite,
        dy.isFinite
      else {
        return Response(ok: false, error: ErrorPayload(message: "transformGesture requires finite x y dx dy"))
      }
      guard let scale = command.scale, scale.isFinite, scale > 0 else {
        return Response(ok: false, error: ErrorPayload(message: "transformGesture requires scale > 0"))
      }
      guard let degrees = command.degrees, degrees.isFinite else {
        return Response(ok: false, error: ErrorPayload(message: "transformGesture requires finite degrees"))
      }
      let durationMs = command.durationMs ?? 300
      guard durationMs.isFinite && durationMs >= 16 else {
        return Response(ok: false, error: ErrorPayload(message: "transformGesture durationMs must be >= 16"))
      }
      var outcome = RunnerInteractionOutcome.performed
      let timing = measureGesture {
        outcome = transformGesture(
          app: activeApp,
          x: x,
          y: y,
          dx: dx,
          dy: dy,
          scale: scale,
          degrees: degrees,
          durationMs: durationMs
        )
      }
      if let response = unsupportedResponse(for: outcome) {
        return response
      }
      return Response(
        ok: true,
        data: DataPayload(
          message: "transformedGesture",
          gestureStartUptimeMs: timing.gestureStartUptimeMs,
          gestureEndUptimeMs: timing.gestureEndUptimeMs
        )
      )
    }
  }

  private func executeTypeCommand(activeApp: XCUIApplication, command: Command) -> Response {
    guard let text = command.text else {
      return Response(ok: false, error: ErrorPayload(message: "type requires text"))
    }
    let delaySeconds = Double(max(command.delayMs ?? 0, 0)) / 1000.0
    let textEntryMode = resolveTextEntryMode(command)
    let target: TextEntryTarget
    if let selectorKey = command.selectorKey, let selectorValue = command.selectorValue {
      let match = findElement(
        app: activeApp,
        selectorKey: selectorKey,
        selectorValue: selectorValue,
        allowNonHittableFallback: command.allowNonHittableCoordinateFallback == true
      )
      if match.isAmbiguous {
        return Response(ok: false, error: ErrorPayload(code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements"))
      }
      guard let element = match.element else {
        return Response(ok: false, error: ErrorPayload(code: "NO_MATCH", message: "selector did not match an element"))
      }
      guard isTextEntryElement(element) else {
        return Response(ok: false, error: ErrorPayload(code: "INVALID_TARGET", message: "selector did not match a text input"))
      }
      target = focusTextInputForTextEntry(app: activeApp, element: element)
    } else {
      target = focusTextInputForTextEntry(app: activeApp, x: command.x, y: command.y)
    }
    if textEntryMode == .replacement {
      guard target.element != nil else {
        let message =
          (command.x != nil && command.y != nil)
          ? "no text input found at the provided coordinates to clear"
          : "no focused text input to clear"
        return Response(ok: false, error: ErrorPayload(message: message))
      }
    }
    let textResult = typeTextReliably(
      app: activeApp,
      target: target,
      text: text,
      delaySeconds: delaySeconds,
      repairMode: textEntryMode
    )
    if textResult.verified == false {
      let expected = textResult.expectedText ?? ""
      let observed = textResult.observedText ?? ""
      return Response(
        ok: false,
        error: ErrorPayload(
          code: "TEXT_ENTRY_MISMATCH",
          message: "text entry verification failed: expected \"\(expected)\", observed \"\(observed)\""
        )
      )
    }
    let point = target.refreshPoint
    let frame = activeApp.frame
    return Response(
      ok: true,
      data: DataPayload(
        message: textResult.repaired ? "typed after repair" : "typed",
        x: point.map { Double($0.x) },
        y: point.map { Double($0.y) },
        referenceWidth: frame.isEmpty ? nil : Double(frame.width),
        referenceHeight: frame.isEmpty ? nil : Double(frame.height)
      )
    )
  }
}
