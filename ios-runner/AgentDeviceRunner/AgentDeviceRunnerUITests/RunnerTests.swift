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
    let timeout = resolveRunnerTimeout()
    let effectiveTimeout = timeout > 0 ? timeout : 24 * 60 * 60
    let result = XCTWaiter.wait(for: [expectation], timeout: effectiveTimeout)
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
    let bundleId = command.appBundleId ?? currentBundleId ?? "com.apple.Preferences"
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
      if hasContent && type != .other { return true }
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

private func resolveRunnerTimeout() -> TimeInterval {
  if let env = ProcessInfo.processInfo.environment["AGENT_DEVICE_RUNNER_TIMEOUT"],
     let parsed = Double(env) {
    return parsed
  }
  return 0
}

enum CommandType: String, Codable {
  case tap
  case type
  case swipe
  case findText
  case listTappables
  case snapshot
  case back
  case home
  case appSwitcher
  case alert
  case pinch
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
  let action: String?
  let x: Double?
  let y: Double?
  let direction: SwipeDirection?
  let scale: Double?
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
