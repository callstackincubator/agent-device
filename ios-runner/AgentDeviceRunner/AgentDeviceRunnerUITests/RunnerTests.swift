//
//  Untitled.swift
//  AgentDeviceRunner
//
//  Created by Michał Pierzchała on 30/01/2026.
//

import XCTest
import Network
import AVFoundation
import CoreVideo
import UIKit

final class RunnerTests: XCTestCase {
  private enum RunnerErrorDomain {
    static let general = "AgentDeviceRunner"
    static let exception = "AgentDeviceRunner.NSException"
  }

  private enum RunnerErrorCode {
    static let noResponseFromMainThread = 1
    static let commandReturnedNoResponse = 2
    static let mainThreadExecutionTimedOut = 3
    static let objcException = 1
  }

  private static let springboardBundleId = "com.apple.springboard"
  private var listener: NWListener?
  private var doneExpectation: XCTestExpectation?
  private let app = XCUIApplication()
  private lazy var springboard = XCUIApplication(bundleIdentifier: Self.springboardBundleId)
  private var currentApp: XCUIApplication?
  private var currentBundleId: String?
  private let maxRequestBytes = 2 * 1024 * 1024
  private let maxSnapshotElements = 600
  private let fastSnapshotLimit = 300
  private let mainThreadExecutionTimeout: TimeInterval = 30
  private let appExistenceTimeout: TimeInterval = 30
  private let retryCooldown: TimeInterval = 0.2
  private let postSnapshotInteractionDelay: TimeInterval = 0.2
  private let firstInteractionAfterActivateDelay: TimeInterval = 0.25
  private let minRecordingFps = 1
  private let maxRecordingFps = 120
  private var needsPostSnapshotInteractionDelay = false
  private var needsFirstInteractionDelay = false
  private var activeRecording: ScreenRecorder?
  private let interactiveTypes: Set<XCUIElement.ElementType> = [
    .button,
    .cell,
    .checkBox,
    .collectionView,
    .link,
    .menuItem,
    .picker,
    .searchField,
    .segmentedControl,
    .slider,
    .stepper,
    .switch,
    .tabBar,
    .textField,
    .secureTextField,
    .textView,
  ]
  // Keep blocker actions narrow to avoid false positives from generic hittable containers.
  private let actionableTypes: Set<XCUIElement.ElementType> = [
    .button,
    .cell,
    .link,
    .menuItem,
    .checkBox,
    .switch,
  ]

  private final class ScreenRecorder {
    private let outputPath: String
    private let fps: Int32?
    private let uncappedFrameInterval: TimeInterval = 0.001
    private var uncappedTimestampTimescale: Int32 {
      Int32(max(1, Int((1.0 / uncappedFrameInterval).rounded())))
    }
    private var frameInterval: TimeInterval {
      guard let fps else { return uncappedFrameInterval }
      return 1.0 / Double(fps)
    }
    private let queue = DispatchQueue(label: "agent-device.runner.recorder")
    private let lock = NSLock()
    private var assetWriter: AVAssetWriter?
    private var writerInput: AVAssetWriterInput?
    private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var timer: DispatchSourceTimer?
    private var recordingStartUptime: TimeInterval?
    private var lastTimestampValue: Int64 = -1
    private var isStopping = false
    private var startedSession = false
    private var startError: Error?

    init(outputPath: String, fps: Int32?) {
      self.outputPath = outputPath
      self.fps = fps
    }

    func start(captureFrame: @escaping () -> UIImage?) throws {
      let url = URL(fileURLWithPath: outputPath)
      let directory = url.deletingLastPathComponent()
      try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: true,
        attributes: nil
      )
      if FileManager.default.fileExists(atPath: outputPath) {
        try FileManager.default.removeItem(atPath: outputPath)
      }

      var dimensions: CGSize = .zero
      var bootstrapImage: UIImage?
      let bootstrapDeadline = Date().addingTimeInterval(2.0)
      while Date() < bootstrapDeadline {
        if let image = captureFrame(), let cgImage = image.cgImage {
          bootstrapImage = image
          dimensions = CGSize(width: cgImage.width, height: cgImage.height)
          break
        }
        Thread.sleep(forTimeInterval: 0.05)
      }
      guard dimensions.width > 0, dimensions.height > 0 else {
        throw NSError(
          domain: "AgentDeviceRunner.Record",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "failed to capture initial frame"]
        )
      }

      let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
      let outputSettings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: Int(dimensions.width),
        AVVideoHeightKey: Int(dimensions.height),
      ]
      let input = AVAssetWriterInput(mediaType: .video, outputSettings: outputSettings)
      input.expectsMediaDataInRealTime = true
      let attributes: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: Int(dimensions.width),
        kCVPixelBufferHeightKey as String: Int(dimensions.height),
      ]
      let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: input,
        sourcePixelBufferAttributes: attributes
      )
      guard writer.canAdd(input) else {
        throw NSError(
          domain: "AgentDeviceRunner.Record",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "failed to add video input"]
        )
      }
      writer.add(input)
      guard writer.startWriting() else {
        throw writer.error ?? NSError(
          domain: "AgentDeviceRunner.Record",
          code: 3,
          userInfo: [NSLocalizedDescriptionKey: "failed to start writing"]
        )
      }

      lock.lock()
      assetWriter = writer
      writerInput = input
      pixelBufferAdaptor = adaptor
      recordingStartUptime = nil
      lastTimestampValue = -1
      isStopping = false
      startedSession = false
      startError = nil
      lock.unlock()

      if let firstImage = bootstrapImage {
        append(image: firstImage)
      }

      let timer = DispatchSource.makeTimerSource(queue: queue)
      timer.schedule(deadline: .now() + frameInterval, repeating: frameInterval)
      timer.setEventHandler { [weak self] in
        guard let self else { return }
        if self.shouldStop() { return }
        guard let image = captureFrame() else { return }
        self.append(image: image)
      }
      self.timer = timer
      timer.resume()
    }

    func stop() throws {
      var writer: AVAssetWriter?
      var input: AVAssetWriterInput?
      var appendError: Error?
      lock.lock()
      if isStopping {
        lock.unlock()
        return
      }
      isStopping = true
      let activeTimer = timer
      timer = nil
      writer = assetWriter
      input = writerInput
      appendError = startError
      lock.unlock()

      activeTimer?.cancel()
      input?.markAsFinished()
      guard let writer else { return }

      let semaphore = DispatchSemaphore(value: 0)
      writer.finishWriting {
        semaphore.signal()
      }
      var stopFailure: Error?
      let waitResult = semaphore.wait(timeout: .now() + 10)
      if waitResult == .timedOut {
        writer.cancelWriting()
        stopFailure = NSError(
          domain: "AgentDeviceRunner.Record",
          code: 6,
          userInfo: [NSLocalizedDescriptionKey: "recording finalization timed out"]
        )
      } else if let appendError {
        stopFailure = appendError
      } else if writer.status == .failed {
        stopFailure = writer.error ?? NSError(
          domain: "AgentDeviceRunner.Record",
          code: 4,
          userInfo: [NSLocalizedDescriptionKey: "failed to finalize recording"]
        )
      }

      lock.lock()
      assetWriter = nil
      writerInput = nil
      pixelBufferAdaptor = nil
      recordingStartUptime = nil
      lastTimestampValue = -1
      startedSession = false
      startError = nil
      lock.unlock()

      if let stopFailure {
        throw stopFailure
      }
    }

    private func append(image: UIImage) {
      guard let cgImage = image.cgImage else { return }
      lock.lock()
      defer { lock.unlock() }
      if isStopping { return }
      if let startError { return }
      guard
        let writer = assetWriter,
        let input = writerInput,
        let adaptor = pixelBufferAdaptor
      else {
        return
      }
      if !startedSession {
        writer.startSession(atSourceTime: .zero)
        startedSession = true
      }
      guard input.isReadyForMoreMediaData else { return }
      guard let pixelBuffer = makePixelBuffer(from: cgImage) else { return }
      let nowUptime = ProcessInfo.processInfo.systemUptime
      if recordingStartUptime == nil {
        recordingStartUptime = nowUptime
      }
      let elapsed = max(0, nowUptime - (recordingStartUptime ?? nowUptime))
      let timescale = fps ?? uncappedTimestampTimescale
      var timestampValue = Int64((elapsed * Double(timescale)).rounded(.down))
      if timestampValue <= lastTimestampValue {
        timestampValue = lastTimestampValue + 1
      }
      let timestamp = CMTime(value: timestampValue, timescale: timescale)
      if !adaptor.append(pixelBuffer, withPresentationTime: timestamp) {
        startError = writer.error ?? NSError(
          domain: "AgentDeviceRunner.Record",
          code: 5,
          userInfo: [NSLocalizedDescriptionKey: "failed to append frame"]
        )
        return
      }
      lastTimestampValue = timestampValue
    }

    private func shouldStop() -> Bool {
      lock.lock()
      defer { lock.unlock() }
      return isStopping
    }

    private func makePixelBuffer(from image: CGImage) -> CVPixelBuffer? {
      guard let adaptor = pixelBufferAdaptor else { return nil }
      var pixelBuffer: CVPixelBuffer?
      guard let pool = adaptor.pixelBufferPool else { return nil }
      let status = CVPixelBufferPoolCreatePixelBuffer(
        nil,
        pool,
        &pixelBuffer
      )
      guard status == kCVReturnSuccess, let pixelBuffer else { return nil }

      CVPixelBufferLockBaseAddress(pixelBuffer, [])
      defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
      guard
        let context = CGContext(
          data: CVPixelBufferGetBaseAddress(pixelBuffer),
          width: image.width,
          height: image.height,
          bitsPerComponent: 8,
          bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
        )
      else {
        return nil
      }
      context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
      return pixelBuffer
    }
  }

  override func setUp() {
    continueAfterFailure = true
  }

  @MainActor
  func testCommand() throws {
    doneExpectation = expectation(description: "agent-device command handled")
    app.launch()
    currentApp = app
    let queue = DispatchQueue(label: "agent-device.runner")
    let desiredPort = resolveRunnerPort()
    NSLog("AGENT_DEVICE_RUNNER_DESIRED_PORT=%d", desiredPort)
    if desiredPort > 0, let port = NWEndpoint.Port(rawValue: desiredPort) {
      listener = try NWListener(using: .tcp, on: port)
    } else {
      listener = try NWListener(using: .tcp)
    }
    listener?.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        NSLog("AGENT_DEVICE_RUNNER_LISTENER_READY")
        if let listenerPort = self?.listener?.port {
          NSLog("AGENT_DEVICE_RUNNER_PORT=%d", listenerPort.rawValue)
        } else {
          NSLog("AGENT_DEVICE_RUNNER_PORT_NOT_SET")
        }
      case .failed(let error):
        NSLog("AGENT_DEVICE_RUNNER_LISTENER_FAILED=%@", String(describing: error))
        self?.doneExpectation?.fulfill()
      default:
        break
      }
    }
    listener?.newConnectionHandler = { [weak self] conn in
      conn.start(queue: queue)
      self?.handle(connection: conn)
    }
    listener?.start(queue: queue)

    guard let expectation = doneExpectation else {
      XCTFail("runner expectation was not initialized")
      return
    }
    NSLog("AGENT_DEVICE_RUNNER_WAITING")
    let result = XCTWaiter.wait(for: [expectation], timeout: 24 * 60 * 60)
    NSLog("AGENT_DEVICE_RUNNER_WAIT_RESULT=%@", String(describing: result))
    if result != .completed {
      XCTFail("runner wait ended with \(result)")
    }
  }

  private func handle(connection: NWConnection) {
    receiveRequest(connection: connection, buffer: Data())
  }

  private func receiveRequest(connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1024 * 1024) { [weak self] data, _, _, _ in
      guard let self = self, let data = data else {
        connection.cancel()
        return
      }
      if buffer.count + data.count > self.maxRequestBytes {
        let response = self.jsonResponse(
          status: 413,
          response: Response(ok: false, error: ErrorPayload(message: "request too large")),
        )
        connection.send(content: response, completion: .contentProcessed { [weak self] _ in
          connection.cancel()
          self?.finish()
        })
        return
      }
      let combined = buffer + data
      if let body = self.parseRequest(data: combined) {
        let result = self.handleRequestBody(body)
        connection.send(content: result.data, completion: .contentProcessed { _ in
          connection.cancel()
          if result.shouldFinish {
            self.finish()
          }
        })
      } else {
        self.receiveRequest(connection: connection, buffer: combined)
      }
    }
  }

  private func parseRequest(data: Data) -> Data? {
    guard let headerEnd = data.range(of: Data("\r\n\r\n".utf8)) else {
      return nil
    }
    let headerData = data.subdata(in: 0..<headerEnd.lowerBound)
    let bodyStart = headerEnd.upperBound
    let headers = String(decoding: headerData, as: UTF8.self)
    let contentLength = extractContentLength(headers: headers)
    guard let contentLength = contentLength else {
      return nil
    }
    if data.count < bodyStart + contentLength {
      return nil
    }
    let body = data.subdata(in: bodyStart..<(bodyStart + contentLength))
    return body
  }

  private func extractContentLength(headers: String) -> Int? {
    for line in headers.split(separator: "\r\n") {
      let parts = line.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
      if parts.count == 2 && parts[0].lowercased() == "content-length" {
        return Int(parts[1])
      }
    }
    return nil
  }

  private func handleRequestBody(_ body: Data) -> (data: Data, shouldFinish: Bool) {
    guard let json = String(data: body, encoding: .utf8) else {
      return (
        jsonResponse(status: 400, response: Response(ok: false, error: ErrorPayload(message: "invalid json"))),
        false
      )
    }
    guard let data = json.data(using: .utf8) else {
      return (
        jsonResponse(status: 400, response: Response(ok: false, error: ErrorPayload(message: "invalid json"))),
        false
      )
    }

    do {
      let command = try JSONDecoder().decode(Command.self, from: data)
      let response = try execute(command: command)
      return (jsonResponse(status: 200, response: response), command.command == .shutdown)
    } catch {
      return (
        jsonResponse(status: 500, response: Response(ok: false, error: ErrorPayload(message: "\(error)"))),
        false
      )
    }
  }

  private func execute(command: Command) throws -> Response {
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
        let fpsLabel = command.fps.map(String.init) ?? "max"
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
    case .tap:
      if let text = command.text {
        if let element = findElement(app: activeApp, text: text) {
          element.tap()
          return Response(ok: true, data: DataPayload(message: "tapped"))
        }
        return Response(ok: false, error: ErrorPayload(message: "element not found"))
      }
      if let x = command.x, let y = command.y {
        tapAt(app: activeApp, x: x, y: y)
        return Response(ok: true, data: DataPayload(message: "tapped"))
      }
      return Response(ok: false, error: ErrorPayload(message: "tap requires text or x/y"))
    case .tapSeries:
      guard let x = command.x, let y = command.y else {
        return Response(ok: false, error: ErrorPayload(message: "tapSeries requires x and y"))
      }
      let count = max(Int(command.count ?? 1), 1)
      let intervalMs = max(command.intervalMs ?? 0, 0)
      let doubleTap = command.doubleTap ?? false
      if doubleTap {
        runSeries(count: count, pauseMs: intervalMs) { _ in
          doubleTapAt(app: activeApp, x: x, y: y)
        }
        return Response(ok: true, data: DataPayload(message: "tap series"))
      }
      runSeries(count: count, pauseMs: intervalMs) { _ in
        tapAt(app: activeApp, x: x, y: y)
      }
      return Response(ok: true, data: DataPayload(message: "tap series"))
    case .longPress:
      guard let x = command.x, let y = command.y else {
        return Response(ok: false, error: ErrorPayload(message: "longPress requires x and y"))
      }
      let duration = (command.durationMs ?? 800) / 1000.0
      longPressAt(app: activeApp, x: x, y: y, duration: duration)
      return Response(ok: true, data: DataPayload(message: "long pressed"))
    case .drag:
      guard let x = command.x, let y = command.y, let x2 = command.x2, let y2 = command.y2 else {
        return Response(ok: false, error: ErrorPayload(message: "drag requires x, y, x2, and y2"))
      }
      let holdDuration = min(max((command.durationMs ?? 60) / 1000.0, 0.016), 10.0)
      dragAt(app: activeApp, x: x, y: y, x2: x2, y2: y2, holdDuration: holdDuration)
      return Response(ok: true, data: DataPayload(message: "dragged"))
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
      runSeries(count: count, pauseMs: pauseMs) { idx in
        let reverse = pattern == "ping-pong" && (idx % 2 == 1)
        if reverse {
          dragAt(app: activeApp, x: x2, y: y2, x2: x, y2: y, holdDuration: holdDuration)
        } else {
          dragAt(app: activeApp, x: x, y: y, x2: x2, y2: y2, holdDuration: holdDuration)
        }
      }
      return Response(ok: true, data: DataPayload(message: "drag series"))
    case .type:
      guard let text = command.text else {
        return Response(ok: false, error: ErrorPayload(message: "type requires text"))
      }
      if command.clearFirst == true {
        guard let focused = focusedTextInput(app: activeApp) else {
          return Response(ok: false, error: ErrorPayload(message: "no focused text input to clear"))
        }
        clearTextInput(focused)
        focused.typeText(text)
        return Response(ok: true, data: DataPayload(message: "typed"))
      }
      if let focused = focusedTextInput(app: activeApp) {
        focused.typeText(text)
      } else {
        activeApp.typeText(text)
      }
      return Response(ok: true, data: DataPayload(message: "typed"))
    case .swipe:
      guard let direction = command.direction else {
        return Response(ok: false, error: ErrorPayload(message: "swipe requires direction"))
      }
      swipe(app: activeApp, direction: direction)
      return Response(ok: true, data: DataPayload(message: "swiped"))
    case .findText:
      guard let text = command.text else {
        return Response(ok: false, error: ErrorPayload(message: "findText requires text"))
      }
      let found = findElement(app: activeApp, text: text) != nil
      return Response(ok: true, data: DataPayload(found: found))
    case .snapshot:
      let options = SnapshotOptions(
        interactiveOnly: command.interactiveOnly ?? false,
        compact: command.compact ?? false,
        depth: command.depth,
        scope: command.scope,
        raw: command.raw ?? false,
      )
      if options.raw {
        needsPostSnapshotInteractionDelay = true
        return Response(ok: true, data: snapshotRaw(app: activeApp, options: options))
      }
      needsPostSnapshotInteractionDelay = true
      return Response(ok: true, data: snapshotFast(app: activeApp, options: options))
    case .back:
      if tapNavigationBack(app: activeApp) {
        return Response(ok: true, data: DataPayload(message: "back"))
      }
      performBackGesture(app: activeApp)
      return Response(ok: true, data: DataPayload(message: "back"))
    case .home:
      XCUIDevice.shared.press(.home)
      return Response(ok: true, data: DataPayload(message: "home"))
    case .appSwitcher:
      performAppSwitcherGesture(app: activeApp)
      return Response(ok: true, data: DataPayload(message: "appSwitcher"))
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
      pinch(app: activeApp, scale: scale, x: command.x, y: command.y)
      return Response(ok: true, data: DataPayload(message: "pinched"))
    }
  }

  private func captureRunnerFrame() -> UIImage? {
    var image: UIImage?
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

  private func stopRecordingIfNeeded() {
    guard let recorder = activeRecording else { return }
    do {
      try recorder.stop()
    } catch {
      NSLog("AGENT_DEVICE_RUNNER_RECORD_STOP_FAILED=%@", String(describing: error))
    }
    activeRecording = nil
  }

  private func resolveRecordingOutPath(_ requestedOutPath: String) -> String {
    let fileName = URL(fileURLWithPath: requestedOutPath).lastPathComponent
    let fallbackName = "agent-device-recording-\(Int(Date().timeIntervalSince1970 * 1000)).mp4"
    let safeFileName = fileName.isEmpty ? fallbackName : fileName
    return (NSTemporaryDirectory() as NSString).appendingPathComponent(safeFileName)
  }

  private func targetNeedsActivation(_ target: XCUIApplication) -> Bool {
    switch target.state {
    case .unknown, .notRunning, .runningBackground, .runningBackgroundSuspended:
      return true
    default:
      return false
    }
  }

  private func activateTarget(bundleId: String, reason: String) -> XCUIApplication {
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

  private func shouldRetryCommand(_ command: Command) -> Bool {
    if isEnvTruthy("AGENT_DEVICE_RUNNER_DISABLE_READONLY_RETRY") {
      return false
    }
    return isReadOnlyCommand(command)
  }

  private func shouldRetryException(_ command: Command, message: String) -> Bool {
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

  private func isReadOnlyCommand(_ command: Command) -> Bool {
    switch command.command {
    case .findText, .snapshot:
      return true
    case .alert:
      let action = (command.action ?? "get").lowercased()
      return action == "get"
    default:
      return false
    }
  }

  private func shouldRetryResponse(_ response: Response) -> Bool {
    guard response.ok == false else { return false }
    guard let message = response.error?.message.lowercased() else { return false }
    return message.contains("is not available")
  }

  private func isInteractionCommand(_ command: CommandType) -> Bool {
    switch command {
    case .tap, .longPress, .drag, .type, .swipe, .back, .appSwitcher, .pinch:
      return true
    default:
      return false
    }
  }

  private func isRunnerLifecycleCommand(_ command: CommandType) -> Bool {
    switch command {
    case .shutdown, .recordStop:
      return true
    default:
      return false
    }
  }

  private func applyInteractionStabilizationIfNeeded() {
    if needsPostSnapshotInteractionDelay {
      sleepFor(postSnapshotInteractionDelay)
      needsPostSnapshotInteractionDelay = false
    }
    if needsFirstInteractionDelay {
      sleepFor(firstInteractionAfterActivateDelay)
      needsFirstInteractionDelay = false
    }
  }

  private func sleepFor(_ delay: TimeInterval) {
    guard delay > 0 else { return }
    usleep(useconds_t(delay * 1_000_000))
  }

  private func tapNavigationBack(app: XCUIApplication) -> Bool {
    let buttons = app.navigationBars.buttons.allElementsBoundByIndex
    if let back = buttons.first(where: { $0.isHittable }) {
      back.tap()
      return true
    }
    return false
  }

  private func performBackGesture(app: XCUIApplication) {
    let target = app.windows.firstMatch.exists ? app.windows.firstMatch : app
    let start = target.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5))
    let end = target.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
    start.press(forDuration: 0.05, thenDragTo: end)
  }

  private func performAppSwitcherGesture(app: XCUIApplication) {
    let target = app.windows.firstMatch.exists ? app.windows.firstMatch : app
    let start = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99))
    let end = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
    start.press(forDuration: 0.6, thenDragTo: end)
  }

  private func findElement(app: XCUIApplication, text: String) -> XCUIElement? {
    let predicate = NSPredicate(format: "label CONTAINS[c] %@ OR identifier CONTAINS[c] %@ OR value CONTAINS[c] %@", text, text, text)
    let element = app.descendants(matching: .any).matching(predicate).firstMatch
    return element.exists ? element : nil
  }

  private func clearTextInput(_ element: XCUIElement) {
    moveCaretToEnd(element: element)
    let count = estimatedDeleteCount(for: element)
    let deletes = String(repeating: XCUIKeyboardKey.delete.rawValue, count: count)
    element.typeText(deletes)
  }

  private func focusedTextInput(app: XCUIApplication) -> XCUIElement? {
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

  private func findScopeElement(app: XCUIApplication, scope: String) -> XCUIElement? {
    let predicate = NSPredicate(
      format: "label CONTAINS[c] %@ OR identifier CONTAINS[c] %@",
      scope,
      scope
    )
    let element = app.descendants(matching: .any).matching(predicate).firstMatch
    return element.exists ? element : nil
  }

  private func tapAt(app: XCUIApplication, x: Double, y: Double) {
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let coordinate = origin.withOffset(CGVector(dx: x, dy: y))
    coordinate.tap()
  }

  private func doubleTapAt(app: XCUIApplication, x: Double, y: Double) {
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let coordinate = origin.withOffset(CGVector(dx: x, dy: y))
    coordinate.doubleTap()
  }

  private func longPressAt(app: XCUIApplication, x: Double, y: Double, duration: TimeInterval) {
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let coordinate = origin.withOffset(CGVector(dx: x, dy: y))
    coordinate.press(forDuration: duration)
  }

  private func dragAt(
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

  private func runSeries(count: Int, pauseMs: Double, operation: (Int) -> Void) {
    let total = max(count, 1)
    let pause = max(pauseMs, 0)
    for idx in 0..<total {
      operation(idx)
      if idx < total - 1 && pause > 0 {
        Thread.sleep(forTimeInterval: pause / 1000.0)
      }
    }
  }

  private func swipe(app: XCUIApplication, direction: SwipeDirection) {
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

  private func pinch(app: XCUIApplication, scale: Double, x: Double?, y: Double?) {
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

  private func aggregatedLabel(for element: XCUIElement, depth: Int = 0) -> String? {
    if depth > 2 { return nil }
    let text = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.isEmpty { return text }
    if let value = element.value {
      let valueText = String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
      if !valueText.isEmpty { return valueText }
    }
    let children = element.children(matching: .any).allElementsBoundByIndex
    for child in children {
      if let childLabel = aggregatedLabel(for: child, depth: depth + 1) {
        return childLabel
      }
    }
    return nil
  }

  private func elementTypeName(_ type: XCUIElement.ElementType) -> String {
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

  private func snapshotFast(app: XCUIApplication, options: SnapshotOptions) -> DataPayload {
    if let blocking = blockingSystemAlertSnapshot() {
      return blocking
    }

    var nodes: [SnapshotNode] = []
    var truncated = false
    let maxDepth = options.depth ?? Int.max
    let viewport = app.frame
    let queryRoot = options.scope.flatMap { findScopeElement(app: app, scope: $0) } ?? app

    let rootSnapshot: XCUIElementSnapshot
    do {
      rootSnapshot = try queryRoot.snapshot()
    } catch {
      return DataPayload(nodes: nodes, truncated: truncated)
    }

    let rootLabel = aggregatedLabel(for: rootSnapshot) ?? rootSnapshot.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let rootIdentifier = rootSnapshot.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    let rootValue = snapshotValueText(rootSnapshot)
    nodes.append(
      SnapshotNode(
        index: 0,
        type: elementTypeName(rootSnapshot.elementType),
        label: rootLabel.isEmpty ? nil : rootLabel,
        identifier: rootIdentifier.isEmpty ? nil : rootIdentifier,
        value: rootValue,
        rect: SnapshotRect(
          x: Double(rootSnapshot.frame.origin.x),
          y: Double(rootSnapshot.frame.origin.y),
          width: Double(rootSnapshot.frame.size.width),
          height: Double(rootSnapshot.frame.size.height),
        ),
        enabled: rootSnapshot.isEnabled,
        hittable: snapshotHittable(rootSnapshot),
        depth: 0,
      )
    )

    var seen = Set<String>()
    var stack: [(XCUIElementSnapshot, Int, Int)] = rootSnapshot.children.map { ($0, 1, 1) }

    while let (snapshot, depth, visibleDepth) = stack.popLast() {
      if nodes.count >= fastSnapshotLimit {
        truncated = true
        break
      }
      if let limit = options.depth, depth > limit { continue }

      let label = aggregatedLabel(for: snapshot) ?? snapshot.label.trimmingCharacters(in: .whitespacesAndNewlines)
      let identifier = snapshot.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
      let valueText = snapshotValueText(snapshot)
      let hasContent = !label.isEmpty || !identifier.isEmpty || (valueText != nil)
      if !isVisibleInViewport(snapshot.frame, viewport) && !hasContent {
        continue
      }

      let include = shouldInclude(
        snapshot: snapshot,
        label: label,
        identifier: identifier,
        valueText: valueText,
        options: options
      )

      let key = "\(snapshot.elementType)-\(label)-\(identifier)-\(snapshot.frame.origin.x)-\(snapshot.frame.origin.y)"
      let isDuplicate = seen.contains(key)
      if !isDuplicate {
        seen.insert(key)
      }

      if depth < maxDepth {
        let nextVisibleDepth = include && !isDuplicate ? visibleDepth + 1 : visibleDepth
        for child in snapshot.children.reversed() {
          stack.append((child, depth + 1, nextVisibleDepth))
        }
      }

      if !include || isDuplicate { continue }

      nodes.append(
        SnapshotNode(
          index: nodes.count,
          type: elementTypeName(snapshot.elementType),
          label: label.isEmpty ? nil : label,
          identifier: identifier.isEmpty ? nil : identifier,
          value: valueText,
          rect: SnapshotRect(
            x: Double(snapshot.frame.origin.x),
            y: Double(snapshot.frame.origin.y),
            width: Double(snapshot.frame.size.width),
            height: Double(snapshot.frame.size.height),
          ),
          enabled: snapshot.isEnabled,
          hittable: snapshotHittable(snapshot),
          depth: min(maxDepth, visibleDepth),
        )
      )

    }

    return DataPayload(nodes: nodes, truncated: truncated)
  }

  private func snapshotRaw(app: XCUIApplication, options: SnapshotOptions) -> DataPayload {
    if let blocking = blockingSystemAlertSnapshot() {
      return blocking
    }

    let root = options.scope.flatMap { findScopeElement(app: app, scope: $0) } ?? app
    var nodes: [SnapshotNode] = []
    var truncated = false
    let viewport = app.frame

    func walk(_ element: XCUIElement, depth: Int) {
      if nodes.count >= maxSnapshotElements {
        truncated = true
        return
      }
      if let limit = options.depth, depth > limit { return }
      if !isVisibleInViewport(element.frame, viewport) { return }

      let label = aggregatedLabel(for: element) ?? element.label.trimmingCharacters(in: .whitespacesAndNewlines)
      let identifier = element.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
      let valueText: String? = {
        guard let value = element.value else { return nil }
        let text = String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
      }()
      if shouldInclude(element: element, label: label, identifier: identifier, valueText: valueText, options: options) {
        nodes.append(
          SnapshotNode(
            index: nodes.count,
            type: elementTypeName(element.elementType),
            label: label.isEmpty ? nil : label,
            identifier: identifier.isEmpty ? nil : identifier,
            value: valueText,
            rect: SnapshotRect(
              x: Double(element.frame.origin.x),
              y: Double(element.frame.origin.y),
              width: Double(element.frame.size.width),
              height: Double(element.frame.size.height),
            ),
            enabled: element.isEnabled,
            hittable: element.isHittable,
            depth: depth,
          )
        )
      }

      let children = element.children(matching: .any).allElementsBoundByIndex
      for child in children {
        walk(child, depth: depth + 1)
        if truncated { return }
      }
    }

    walk(root, depth: 0)
    return DataPayload(nodes: nodes, truncated: truncated)
  }

  private func blockingSystemAlertSnapshot() -> DataPayload? {
    guard let modal = firstBlockingSystemModal(in: springboard) else {
      return nil
    }
    let actions = actionableElements(in: modal)
    guard !actions.isEmpty else {
      return nil
    }

    let title = preferredSystemModalTitle(modal)
    guard let modalNode = safeMakeSnapshotNode(
      element: modal,
      index: 0,
      type: "Alert",
      labelOverride: title,
      identifierOverride: modal.identifier,
      depth: 0,
      hittableOverride: true
    ) else {
      return nil
    }
    var nodes: [SnapshotNode] = [modalNode]

    for action in actions {
      guard let actionNode = safeMakeSnapshotNode(
        element: action,
        index: nodes.count,
        type: elementTypeName(action.elementType),
        depth: 1,
        hittableOverride: true
      ) else {
        continue
      }
      nodes.append(actionNode)
    }

    return DataPayload(nodes: nodes, truncated: false)
  }

  private func firstBlockingSystemModal(in springboard: XCUIApplication) -> XCUIElement? {
    let disableSafeProbe = isEnvTruthy("AGENT_DEVICE_RUNNER_DISABLE_SAFE_MODAL_PROBE")
    let queryElements: (() -> [XCUIElement]) -> [XCUIElement] = { fetch in
      if disableSafeProbe {
        return fetch()
      }
      return self.safeElementsQuery(fetch)
    }

    let alerts = queryElements {
      springboard.alerts.allElementsBoundByIndex
    }
    for alert in alerts {
      if safeIsBlockingSystemModal(alert, in: springboard) {
        return alert
      }
    }

    let sheets = queryElements {
      springboard.sheets.allElementsBoundByIndex
    }
    for sheet in sheets {
      if safeIsBlockingSystemModal(sheet, in: springboard) {
        return sheet
      }
    }

    return nil
  }

  private func safeElementsQuery(_ fetch: () -> [XCUIElement]) -> [XCUIElement] {
    var elements: [XCUIElement] = []
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      elements = fetch()
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_MODAL_QUERY_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return []
    }
    return elements
  }

  private func safeIsBlockingSystemModal(_ element: XCUIElement, in springboard: XCUIApplication) -> Bool {
    var isBlocking = false
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      isBlocking = isBlockingSystemModal(element, in: springboard)
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_MODAL_CHECK_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return false
    }
    return isBlocking
  }

  private func isBlockingSystemModal(_ element: XCUIElement, in springboard: XCUIApplication) -> Bool {
    guard element.exists else { return false }
    let frame = element.frame
    if frame.isNull || frame.isEmpty { return false }

    let viewport = springboard.frame
    if viewport.isNull || viewport.isEmpty { return false }

    let center = CGPoint(x: frame.midX, y: frame.midY)
    if !viewport.contains(center) { return false }

    return true
  }

  private func actionableElements(in element: XCUIElement) -> [XCUIElement] {
    var seen = Set<String>()
    var actions: [XCUIElement] = []
    let descendants = safeElementsQuery {
      element.descendants(matching: .any).allElementsBoundByIndex
    }
    for candidate in descendants {
      if !safeIsActionableCandidate(candidate, seen: &seen) { continue }
      actions.append(candidate)
    }
    return actions
  }

  private func safeIsActionableCandidate(_ candidate: XCUIElement, seen: inout Set<String>) -> Bool {
    var include = false
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      if !candidate.exists || !candidate.isHittable { return }
      if !actionableTypes.contains(candidate.elementType) { return }
      let frame = candidate.frame
      if frame.isNull || frame.isEmpty { return }
      let key = "\(candidate.elementType.rawValue)-\(frame.origin.x)-\(frame.origin.y)-\(frame.size.width)-\(frame.size.height)-\(candidate.label)"
      if seen.contains(key) { return }
      seen.insert(key)
      include = true
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_MODAL_ACTION_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return false
    }
    return include
  }

  private func preferredSystemModalTitle(_ element: XCUIElement) -> String {
    let label = element.label
    if !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return label
    }
    let identifier = element.identifier
    if !identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return identifier
    }
    return "System Alert"
  }

  private func makeSnapshotNode(
    element: XCUIElement,
    index: Int,
    type: String,
    labelOverride: String? = nil,
    identifierOverride: String? = nil,
    depth: Int,
    hittableOverride: Bool? = nil
  ) -> SnapshotNode {
    let label = (labelOverride ?? element.label).trimmingCharacters(in: .whitespacesAndNewlines)
    let identifier = (identifierOverride ?? element.identifier).trimmingCharacters(in: .whitespacesAndNewlines)
    return SnapshotNode(
      index: index,
      type: type,
      label: label.isEmpty ? nil : label,
      identifier: identifier.isEmpty ? nil : identifier,
      value: nil,
      rect: snapshotRect(from: element.frame),
      enabled: element.isEnabled,
      hittable: hittableOverride ?? element.isHittable,
      depth: depth
    )
  }

  private func safeMakeSnapshotNode(
    element: XCUIElement,
    index: Int,
    type: String,
    labelOverride: String? = nil,
    identifierOverride: String? = nil,
    depth: Int,
    hittableOverride: Bool? = nil
  ) -> SnapshotNode? {
    var node: SnapshotNode?
    let exceptionMessage = RunnerObjCExceptionCatcher.catchException({
      node = makeSnapshotNode(
        element: element,
        index: index,
        type: type,
        labelOverride: labelOverride,
        identifierOverride: identifierOverride,
        depth: depth,
        hittableOverride: hittableOverride
      )
    })
    if let exceptionMessage {
      NSLog(
        "AGENT_DEVICE_RUNNER_MODAL_NODE_IGNORED_EXCEPTION=%@",
        exceptionMessage
      )
      return nil
    }
    return node
  }

  private func snapshotRect(from frame: CGRect) -> SnapshotRect {
    return SnapshotRect(
      x: Double(frame.origin.x),
      y: Double(frame.origin.y),
      width: Double(frame.size.width),
      height: Double(frame.size.height)
    )
  }

  private func shouldInclude(
    element: XCUIElement,
    label: String,
    identifier: String,
    valueText: String?,
    options: SnapshotOptions
  ) -> Bool {
    let type = element.elementType
    let hasContent = !label.isEmpty || !identifier.isEmpty || (valueText != nil)
    if options.compact && type == .other && !hasContent && !element.isHittable {
      let children = element.children(matching: .any).allElementsBoundByIndex
      if children.count <= 1 { return false }
    }
    if options.interactiveOnly {
      if interactiveTypes.contains(type) { return true }
      if element.isHittable && type != .other { return true }
      if hasContent { return true }
      return false
    }
    if options.compact {
      return hasContent || element.isHittable
    }
    return true
  }

  private func shouldInclude(
    snapshot: XCUIElementSnapshot,
    label: String,
    identifier: String,
    valueText: String?,
    options: SnapshotOptions
  ) -> Bool {
    let type = snapshot.elementType
    let hasContent = !label.isEmpty || !identifier.isEmpty || (valueText != nil)
    if options.compact && type == .other && !hasContent && !snapshotHittable(snapshot) {
      if snapshot.children.count <= 1 { return false }
    }
    if options.interactiveOnly {
      if interactiveTypes.contains(type) { return true }
      if snapshotHittable(snapshot) && type != .other { return true }
      if hasContent { return true }
      return false
    }
    if options.compact {
      return hasContent || snapshotHittable(snapshot)
    }
    return true
  }

  private func snapshotValueText(_ snapshot: XCUIElementSnapshot) -> String? {
    guard let value = snapshot.value else { return nil }
    let text = String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }

  private func snapshotHittable(_ snapshot: XCUIElementSnapshot) -> Bool {
    // XCUIElementSnapshot does not expose isHittable; use enabled as a lightweight proxy.
    return snapshot.isEnabled
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

  private func jsonResponse(status: Int, response: Response) -> Data {
    let encoder = JSONEncoder()
    let body = (try? encoder.encode(response)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    return httpResponse(status: status, body: body)
  }

  private func httpResponse(status: Int, body: String) -> Data {
    let headers = [
      "HTTP/1.1 \(status) OK",
      "Content-Type: application/json",
      "Content-Length: \(body.utf8.count)",
      "Connection: close",
      "",
      body,
    ].joined(separator: "\r\n")
    return Data(headers.utf8)
  }

  private func finish() {
    listener?.cancel()
    listener = nil
    doneExpectation?.fulfill()
  }
}

private func resolveRunnerPort() -> UInt16 {
  if let env = ProcessInfo.processInfo.environment["AGENT_DEVICE_RUNNER_PORT"], let port = UInt16(env) {
    return port
  }
  for arg in CommandLine.arguments {
    if arg.hasPrefix("AGENT_DEVICE_RUNNER_PORT=") {
      let value = arg.replacingOccurrences(of: "AGENT_DEVICE_RUNNER_PORT=", with: "")
      if let port = UInt16(value) { return port }
    }
  }
  return 0
}

private func isEnvTruthy(_ name: String) -> Bool {
  guard let raw = ProcessInfo.processInfo.environment[name] else {
    return false
  }
  switch raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
  case "1", "true", "yes", "on":
    return true
  default:
    return false
  }
}

enum CommandType: String, Codable {
  case tap
  case tapSeries
  case longPress
  case drag
  case dragSeries
  case type
  case swipe
  case findText
  case snapshot
  case back
  case home
  case appSwitcher
  case alert
  case pinch
  case recordStart
  case recordStop
  case shutdown
}

enum SwipeDirection: String, Codable {
  case up
  case down
  case left
  case right
}

struct Command: Codable {
  let command: CommandType
  let appBundleId: String?
  let text: String?
  let clearFirst: Bool?
  let action: String?
  let x: Double?
  let y: Double?
  let count: Double?
  let intervalMs: Double?
  let doubleTap: Bool?
  let pauseMs: Double?
  let pattern: String?
  let x2: Double?
  let y2: Double?
  let durationMs: Double?
  let direction: SwipeDirection?
  let scale: Double?
  let outPath: String?
  let fps: Int?
  let interactiveOnly: Bool?
  let compact: Bool?
  let depth: Int?
  let scope: String?
  let raw: Bool?
}

struct Response: Codable {
  let ok: Bool
  let data: DataPayload?
  let error: ErrorPayload?

  init(ok: Bool, data: DataPayload? = nil, error: ErrorPayload? = nil) {
    self.ok = ok
    self.data = data
    self.error = error
  }
}

struct DataPayload: Codable {
  let message: String?
  let found: Bool?
  let items: [String]?
  let nodes: [SnapshotNode]?
  let truncated: Bool?

  init(
    message: String? = nil,
    found: Bool? = nil,
    items: [String]? = nil,
    nodes: [SnapshotNode]? = nil,
    truncated: Bool? = nil
  ) {
    self.message = message
    self.found = found
    self.items = items
    self.nodes = nodes
    self.truncated = truncated
  }
}

struct ErrorPayload: Codable {
  let message: String
}

struct SnapshotRect: Codable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct SnapshotNode: Codable {
  let index: Int
  let type: String
  let label: String?
  let identifier: String?
  let value: String?
  let rect: SnapshotRect
  let enabled: Bool
  let hittable: Bool
  let depth: Int
}

struct SnapshotOptions {
  let interactiveOnly: Bool
  let compact: Bool
  let depth: Int?
  let scope: String?
  let raw: Bool
}
