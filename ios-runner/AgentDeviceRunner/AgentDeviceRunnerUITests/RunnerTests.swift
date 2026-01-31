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
  private let maxSnapshotElements = 600
  private let fastSnapshotLimit = 300
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
    .textView,
  ]

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
    let result = XCTWaiter.wait(for: [expectation], timeout: resolveRunnerTimeout())
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
      NSLog("AGENT_DEVICE_RUNNER_ACTIVATE bundle=%@ state=%d", bundleId, target.state.rawValue)
      // activate avoids terminating and relaunching the target app
      target.activate()
      currentApp = target
      currentBundleId = bundleId
    }
    let activeApp = currentApp ?? app
    _ = activeApp.waitForExistence(timeout: 5)

    switch command.command {
    case .shutdown:
      return Response(ok: true, data: DataPayload(message: "shutdown"))
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
    case .rect:
      guard let text = command.text else {
        return Response(ok: false, error: ErrorPayload(message: "rect requires text"))
      }
      guard let element = findElement(app: activeApp, text: text) else {
        return Response(ok: false, error: ErrorPayload(message: "element not found"))
      }
      let frame = element.frame
      let rect = SnapshotRect(
        x: Double(frame.origin.x),
        y: Double(frame.origin.y),
        width: Double(frame.size.width),
        height: Double(frame.size.height)
      )
      return Response(ok: true, data: DataPayload(rect: rect))
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
    case .snapshot:
      let options = SnapshotOptions(
        interactiveOnly: command.interactiveOnly ?? false,
        compact: command.compact ?? false,
        depth: command.depth,
        scope: command.scope,
        raw: command.raw ?? false,
      )
      if options.raw {
        return Response(ok: true, data: snapshotRaw(app: activeApp, options: options))
      }
      return Response(ok: true, data: snapshotFast(app: activeApp, options: options))
    }
  }

  private func findElement(app: XCUIApplication, text: String) -> XCUIElement? {
    let predicate = NSPredicate(format: "label CONTAINS[c] %@ OR identifier CONTAINS[c] %@ OR value CONTAINS[c] %@", text, text, text)
    let element = app.descendants(matching: .any).matching(predicate).firstMatch
    return element.exists ? element : nil
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
    default: return "Element(\(type.rawValue))"
    }
  }

  private func snapshotFast(app: XCUIApplication, options: SnapshotOptions) -> DataPayload {
    var nodes: [SnapshotNode] = []
    var truncated = false
    let maxDepth = options.depth ?? 2
    let viewport = app.frame
    let rootLabel = aggregatedLabel(for: app) ?? app.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let rootNode = SnapshotNode(
      index: 0,
      type: "Application",
      label: rootLabel.isEmpty ? nil : rootLabel,
      identifier: app.identifier.isEmpty ? nil : app.identifier,
      value: nil,
      rect: SnapshotRect(
        x: Double(app.frame.origin.x),
        y: Double(app.frame.origin.y),
        width: Double(app.frame.size.width),
        height: Double(app.frame.size.height),
      ),
      enabled: app.isEnabled,
      hittable: app.isHittable,
      depth: 0,
    )
    nodes.append(rootNode)

    let queryRoot = options.scope.flatMap { findScopeElement(app: app, scope: $0) } ?? app
    let elements = collectFastElements(root: queryRoot)
    var seen = Set<String>()

    for element in elements {
      if nodes.count >= fastSnapshotLimit {
        truncated = true
        break
      }
      if !isVisibleInViewport(element.frame, viewport) { continue }
      let label = aggregatedLabel(for: element) ?? element.label.trimmingCharacters(in: .whitespacesAndNewlines)
      let identifier = element.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
      let valueText: String? = {
        guard let value = element.value else { return nil }
        let text = String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
      }()
      if !shouldInclude(element: element, label: label, identifier: identifier, valueText: valueText, options: options) {
        continue
      }
      let key = "\(element.elementType)-\(label)-\(identifier)-\(element.frame.origin.x)-\(element.frame.origin.y)"
      if seen.contains(key) { continue }
      seen.insert(key)
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
          depth: min(maxDepth, 1),
        )
      )
    }

    return DataPayload(nodes: nodes, truncated: truncated)
  }

  private func snapshotRaw(app: XCUIApplication, options: SnapshotOptions) -> DataPayload {
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
      if hasContent && type != .other { return true }
      return false
    }
    if options.compact {
      return hasContent || element.isHittable
    }
    return true
  }

  private func collectFastElements(root: XCUIElement) -> [XCUIElement] {
    var elements: [XCUIElement] = []
    elements.append(contentsOf: root.buttons.allElementsBoundByIndex)
    elements.append(contentsOf: root.links.allElementsBoundByIndex)
    elements.append(contentsOf: root.cells.allElementsBoundByIndex)
    elements.append(contentsOf: root.staticTexts.allElementsBoundByIndex)
    elements.append(contentsOf: root.switches.allElementsBoundByIndex)
    elements.append(contentsOf: root.textFields.allElementsBoundByIndex)
    elements.append(contentsOf: root.textViews.allElementsBoundByIndex)
    elements.append(contentsOf: root.navigationBars.allElementsBoundByIndex)
    elements.append(contentsOf: root.tabBars.allElementsBoundByIndex)
    elements.append(contentsOf: root.searchFields.allElementsBoundByIndex)
    elements.append(contentsOf: root.segmentedControls.allElementsBoundByIndex)
    elements.append(contentsOf: root.collectionViews.allElementsBoundByIndex)
    elements.append(contentsOf: root.tables.allElementsBoundByIndex)
    return elements
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

private func resolveRunnerTimeout() -> TimeInterval {
  if let env = ProcessInfo.processInfo.environment["AGENT_DEVICE_RUNNER_TIMEOUT"],
     let parsed = Double(env) {
    return parsed
  }
  return 300
}

enum CommandType: String, Codable {
  case tap
  case type
  case swipe
  case findText
  case listTappables
  case snapshot
  case rect
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
  let x: Double?
  let y: Double?
  let direction: SwipeDirection?
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
  let rect: SnapshotRect?

  init(
    message: String? = nil,
    found: Bool? = nil,
    items: [String]? = nil,
    nodes: [SnapshotNode]? = nil,
    truncated: Bool? = nil,
    rect: SnapshotRect? = nil
  ) {
    self.message = message
    self.found = found
    self.items = items
    self.nodes = nodes
    self.truncated = truncated
    self.rect = rect
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
