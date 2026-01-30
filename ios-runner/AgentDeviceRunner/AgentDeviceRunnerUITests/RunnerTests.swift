//
//  Untitled.swift
//  AgentDeviceRunner
//
//  Created by Michał Pierzchała on 30/01/2026.
//

import XCTest
import Network

final class RunnerTests: XCTestCase {
  private var listener: NWListener?
  private var port: UInt16 = 0
  private var doneExpectation: XCTestExpectation?
  private let app = XCUIApplication()
  private var currentApp: XCUIApplication?
  private var currentBundleId: String?
  private let maxRequestBytes = 2 * 1024 * 1024

  override func setUp() {
    continueAfterFailure = false
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
          self?.port = listenerPort.rawValue
          NSLog("AGENT_DEVICE_RUNNER_PORT=%d", listenerPort.rawValue)
        } else {
          NSLog("AGENT_DEVICE_RUNNER_PORT_NOT_SET")
        }
      case .failed(let error):
        NSLog("AGENT_DEVICE_RUNNER_LISTENER_FAILED=%@", String(describing: error))
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
    let result = XCTWaiter.wait(for: [expectation], timeout: 10)
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
        let response = self.handleRequestBody(body)
        connection.send(content: response, completion: .contentProcessed { _ in
          connection.cancel()
          self.finish()
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

  private func handleRequestBody(_ body: Data) -> Data {
    guard let json = String(data: body, encoding: .utf8) else {
      return jsonResponse(status: 400, response: Response(ok: false, error: ErrorPayload(message: "invalid json")))
    }
    guard let data = json.data(using: .utf8) else {
      return jsonResponse(status: 400, response: Response(ok: false, error: ErrorPayload(message: "invalid json")))
    }

    do {
      let command = try JSONDecoder().decode(Command.self, from: data)
      let response = try execute(command: command)
      return jsonResponse(status: 200, response: response)
    } catch {
      return jsonResponse(status: 500, response: Response(ok: false, error: ErrorPayload(message: "\(error)")))
    }
  }

  private func execute(command: Command) throws -> Response {
    if Thread.isMainThread {
      return try executeOnMain(command: command)
    }
    var result: Result<Response, Error>?
    let semaphore = DispatchSemaphore(value: 0)
    DispatchQueue.main.async {
      do {
        result = .success(try self.executeOnMain(command: command))
      } catch {
        result = .failure(error)
      }
      semaphore.signal()
    }
    semaphore.wait()
    switch result {
    case .success(let response):
      return response
    case .failure(let error):
      throw error
    case .none:
      throw NSError(domain: "AgentDeviceRunner", code: 1, userInfo: [NSLocalizedDescriptionKey: "no response from main thread"])
    }
  }

  private func executeOnMain(command: Command) throws -> Response {
    let bundleId = command.appBundleId ?? "com.apple.Preferences"
    if currentBundleId != bundleId {
      let target = XCUIApplication(bundleIdentifier: bundleId)
      target.launch()
      currentApp = target
      currentBundleId = bundleId
    }
    let activeApp = currentApp ?? app
    _ = activeApp.waitForExistence(timeout: 5)

    switch command.command {
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
    case .type:
      guard let text = command.text else {
        return Response(ok: false, error: ErrorPayload(message: "type requires text"))
      }
      activeApp.typeText(text)
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
    case .listTappables:
      let elements = activeApp.descendants(matching: .any).allElementsBoundByIndex
      let labels = elements.compactMap { element -> String? in
        guard element.isHittable else { return nil }
        let label = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
        if label.isEmpty { return nil }
        let identifier = element.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        return identifier.isEmpty ? label : "\(label) [\(identifier)]"
      }
      let unique = Array(Set(labels)).sorted()
      return Response(ok: true, data: DataPayload(items: unique))
    }
  }

  private func findElement(app: XCUIApplication, text: String) -> XCUIElement? {
    let predicate = NSPredicate(format: "label CONTAINS[c] %@ OR identifier CONTAINS[c] %@ OR value CONTAINS[c] %@", text, text, text)
    let element = app.descendants(matching: .any).matching(predicate).firstMatch
    return element.exists ? element : nil
  }

  private func tapAt(app: XCUIApplication, x: Double, y: Double) {
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let coordinate = origin.withOffset(CGVector(dx: x, dy: y))
    coordinate.tap()
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

enum CommandType: String, Codable {
  case tap
  case type
  case swipe
  case findText
  case listTappables
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
  let x: Double?
  let y: Double?
  let direction: SwipeDirection?
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

  init(message: String? = nil, found: Bool? = nil, items: [String]? = nil) {
    self.message = message
    self.found = found
    self.items = items
  }
}

struct ErrorPayload: Codable {
  let message: String
}
