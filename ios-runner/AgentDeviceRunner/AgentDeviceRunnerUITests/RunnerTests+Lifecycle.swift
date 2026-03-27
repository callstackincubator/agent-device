import XCTest
#if canImport(AppKit)
import AppKit
#endif

func runnerPngData(for image: RunnerImage) -> Data? {
#if canImport(UIKit)
  return image.pngData()
#elseif canImport(AppKit)
  guard let cgImage = runnerCGImage(from: image) else { return nil }
  let bitmap = NSBitmapImageRep(cgImage: cgImage)
  return bitmap.representation(using: .png, properties: [:])
#endif
}

func runnerCGImage(from image: RunnerImage) -> CGImage? {
#if canImport(UIKit)
  return image.cgImage
#elseif canImport(AppKit)
  return image.cgImage(forProposedRect: nil, context: nil, hints: nil)
#endif
}

extension RunnerTests {
  // MARK: - Recording

  func captureRunnerFrame() -> RunnerImage? {
    var image: RunnerImage?
    let capture = {
      let screenshot = XCUIScreen.main.screenshot()
      image = screenshot.image
    }
    if Thread.isMainThread {
      capture()
    } else {
      DispatchQueue.main.sync(execute: capture)
    }
    return image
  }

  func screenshotRoot(app: XCUIApplication) -> XCUIElement {
#if os(macOS)
    let windows = app.windows.allElementsBoundByIndex
    if let window = windows.first(where: { $0.exists && !$0.frame.isNull && !$0.frame.isEmpty }) {
      return window
    }
#endif
    return app
  }

  func stopRecordingIfNeeded() {
    guard let recorder = activeRecording else { return }
    do {
      try recorder.stop()
    } catch {
      NSLog("AGENT_DEVICE_RUNNER_RECORD_STOP_FAILED=%@", String(describing: error))
    }
    activeRecording = nil
  }

  func resolveRecordingOutPath(_ requestedOutPath: String) -> String {
#if os(macOS)
    if requestedOutPath.hasPrefix("/") {
      return requestedOutPath
    }
#endif
    let fileName = URL(fileURLWithPath: requestedOutPath).lastPathComponent
    let fallbackName = "agent-device-recording-\(Int(Date().timeIntervalSince1970 * 1000)).mp4"
    let safeFileName = fileName.isEmpty ? fallbackName : fileName
    return (NSTemporaryDirectory() as NSString).appendingPathComponent(safeFileName)
  }

  // MARK: - Target Activation

  func targetNeedsActivation(_ target: XCUIApplication) -> Bool {
    let state = target.state
#if os(macOS)
    if state == .unknown || state == .notRunning || state == .runningBackground {
      return true
    }
#else
    if state == .unknown || state == .notRunning || state == .runningBackground
      || state == .runningBackgroundSuspended
    {
      return true
    }
#endif
    return false
  }

  func activateTarget(bundleId: String, reason: String) -> XCUIApplication {
    let target = XCUIApplication(bundleIdentifier: bundleId)
    NSLog(
      "AGENT_DEVICE_RUNNER_ACTIVATE bundle=%@ state=%d reason=%@",
      bundleId,
      target.state.rawValue,
      reason
    )
    // activate avoids terminating and relaunching the target app
    target.activate()
    currentApp = target
    currentBundleId = bundleId
    needsFirstInteractionDelay = true
    return target
  }

  func withTemporaryScrollIdleTimeoutIfSupported(
    _ target: XCUIApplication,
    operation: () -> Void
  ) {
    let setter = NSSelectorFromString("setWaitForIdleTimeout:")
    guard target.responds(to: setter) else {
      operation()
      return
    }
    let previous = target.value(forKey: "waitForIdleTimeout") as? NSNumber
    target.setValue(resolveScrollInteractionIdleTimeout(), forKey: "waitForIdleTimeout")
    defer {
      if let previous {
        target.setValue(previous.doubleValue, forKey: "waitForIdleTimeout")
      }
    }
    operation()
  }

  private func resolveScrollInteractionIdleTimeout() -> TimeInterval {
    guard
      let raw = ProcessInfo.processInfo.environment["AGENT_DEVICE_IOS_INTERACTION_IDLE_TIMEOUT"],
      !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return scrollInteractionIdleTimeoutDefault
    }
    guard let parsed = Double(raw), parsed >= 0 else {
      return scrollInteractionIdleTimeoutDefault
    }
    return min(parsed, 30)
  }

  func shouldRetryCommand(_ command: Command) -> Bool {
    if RunnerEnv.isTruthy("AGENT_DEVICE_RUNNER_DISABLE_READONLY_RETRY") {
      return false
    }
    return isReadOnlyCommand(command)
  }

  func shouldRetryException(_ command: Command, message: String) -> Bool {
    guard shouldRetryCommand(command) else { return false }
    let normalized = message.lowercased()
    if normalized.contains("kaxerrorservernotfound") {
      return true
    }
    if normalized.contains("main thread execution timed out") {
      return true
    }
    if normalized.contains("timed out") && command.command == .snapshot {
      return true
    }
    return false
  }

  // MARK: - Command Classification

  func isReadOnlyCommand(_ command: Command) -> Bool {
    switch command.command {
    case .interactionFrame, .findText, .readText, .snapshot, .screenshot:
      return true
    case .alert:
      let action = (command.action ?? "get").lowercased()
      return action == "get"
    default:
      return false
    }
  }

  func shouldRetryResponse(_ response: Response) -> Bool {
    guard response.ok == false else { return false }
    guard let message = response.error?.message.lowercased() else { return false }
    return message.contains("is not available")
  }

  func isInteractionCommand(_ command: CommandType) -> Bool {
    switch command {
    case
      .tap,
      .longPress,
      .drag,
      .type,
      .swipe,
      .back,
      .backInApp,
      .backSystem,
      .appSwitcher,
      .keyboardDismiss,
      .pinch:
      return true
    default:
      return false
    }
  }

  func isRunnerLifecycleCommand(_ command: CommandType) -> Bool {
    switch command {
    case .shutdown, .recordStop, .screenshot:
      return true
    default:
      return false
    }
  }

  // MARK: - Interaction Stabilization

  func applyInteractionStabilizationIfNeeded() {
    if needsPostSnapshotInteractionDelay {
      sleepFor(postSnapshotInteractionDelay)
      needsPostSnapshotInteractionDelay = false
    }
    if needsFirstInteractionDelay {
      sleepFor(firstInteractionAfterActivateDelay)
      needsFirstInteractionDelay = false
    }
  }

  func sleepFor(_ delay: TimeInterval) {
    guard delay > 0 else { return }
    usleep(useconds_t(delay * 1_000_000))
  }
}
