import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

enum HelperError: Error {
  case invalidArgs(String)
  case commandFailed(String, details: [String: String] = [:])
}

struct ErrorPayload: Encodable {
  let message: String
  let details: [String: String]?
}

struct SuccessEnvelope<T: Encodable>: Encodable {
  let ok = true
  let data: T
}

struct FailureEnvelope: Encodable {
  let ok = false
  let error: ErrorPayload
}

struct FrontmostAppResponse: Encodable {
  let bundleId: String?
  let appName: String?
  let pid: Int32?
}

struct QuitAppResponse: Encodable {
  let bundleId: String
  let running: Bool
  let terminated: Bool
  let forceTerminated: Bool
}

struct PermissionResponse: Encodable {
  let target: String
  let action: String
  let granted: Bool
  let requested: Bool
  let openedSettings: Bool
  let message: String?
}

struct AlertResponse: Encodable {
  let title: String?
  let role: String?
  let buttons: [String]
  let action: String?
  let bundleId: String?
}

struct RectResponse: Encodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct SnapshotNodeResponse: Encodable {
  let index: Int
  let type: String?
  let role: String?
  let subrole: String?
  let label: String?
  let value: String?
  let identifier: String?
  let rect: RectResponse?
  let enabled: Bool?
  let selected: Bool?
  let hittable: Bool?
  let depth: Int
  let parentIndex: Int?
  let pid: Int32?
  let bundleId: String?
  let appName: String?
  let windowTitle: String?
  let surface: String?
}

struct SnapshotResponse: Encodable {
  let surface: String
  let nodes: [SnapshotNodeResponse]
  let truncated = false
  let backend = "macos-helper"
}

@main
struct AgentDeviceMacOSHelper {
  static func main() {
    do {
      let output = try run(arguments: Array(CommandLine.arguments.dropFirst()))
      try writeJSON(output)
      Foundation.exit(0)
    } catch let error as HelperError {
      let payload: FailureEnvelope
      switch error {
      case .invalidArgs(let message):
        payload = FailureEnvelope(error: ErrorPayload(message: message, details: nil))
      case .commandFailed(let message, let details):
        payload = FailureEnvelope(
          error: ErrorPayload(message: message, details: details.isEmpty ? nil : details)
        )
      }
      try? writeJSON(payload)
      Foundation.exit(1)
    } catch {
      let payload = FailureEnvelope(
        error: ErrorPayload(message: String(describing: error), details: nil)
      )
      try? writeJSON(payload)
      Foundation.exit(1)
    }
  }

  static func run(arguments: [String]) throws -> any Encodable {
    guard let command = arguments.first else {
      throw HelperError.invalidArgs("missing command")
    }

    switch command {
    case "app":
      return try handleApp(arguments: Array(arguments.dropFirst()))
    case "permission":
      return try handlePermission(arguments: Array(arguments.dropFirst()))
    case "alert":
      return try handleAlert(arguments: Array(arguments.dropFirst()))
    case "snapshot":
      return try handleSnapshot(arguments: Array(arguments.dropFirst()))
    default:
      throw HelperError.invalidArgs("unknown command: \(command)")
    }
  }

  static func handleApp(arguments: [String]) throws -> any Encodable {
    guard let action = arguments.first else {
      throw HelperError.invalidArgs("app requires frontmost|quit")
    }
    switch action {
    case "frontmost":
      let app = NSWorkspace.shared.frontmostApplication
      return SuccessEnvelope(
        data: FrontmostAppResponse(
          bundleId: app?.bundleIdentifier,
          appName: app?.localizedName,
          pid: app.map { Int32($0.processIdentifier) }
        )
      )
    case "quit":
      guard let rawBundleId = optionValue(arguments: Array(arguments.dropFirst()), name: "--bundle-id"),
            !rawBundleId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else {
        throw HelperError.invalidArgs("app quit requires --bundle-id <id>")
      }
      let bundleId = try validatedBundleId(rawBundleId)
      let apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
      guard let app = apps.first else {
        return SuccessEnvelope(
          data: QuitAppResponse(
            bundleId: bundleId,
            running: false,
            terminated: false,
            forceTerminated: false
          )
        )
      }
      let terminated = app.terminate()
      if terminated {
        return SuccessEnvelope(
          data: QuitAppResponse(
            bundleId: bundleId,
            running: true,
            terminated: true,
            forceTerminated: false
          )
        )
      }
      let forceTerminated = app.forceTerminate()
      return SuccessEnvelope(
        data: QuitAppResponse(
          bundleId: bundleId,
          running: true,
          terminated: false,
          forceTerminated: forceTerminated
        )
      )
    default:
      throw HelperError.invalidArgs("app requires frontmost|quit")
    }
  }

  static func handlePermission(arguments: [String]) throws -> any Encodable {
    guard arguments.count >= 2 else {
      throw HelperError.invalidArgs(
        "permission requires <grant|reset> <accessibility|screen-recording|input-monitoring>"
      )
    }
    let action = arguments[0]
    let target = arguments[1]
    switch (action, target) {
    case ("grant", "accessibility"):
      let before = AXIsProcessTrusted()
      let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
      let after = AXIsProcessTrustedWithOptions(options as CFDictionary)
      return SuccessEnvelope(
        data: PermissionResponse(
          target: target,
          action: action,
          granted: before || after,
          requested: !before,
          openedSettings: false,
          message: before ? "Accessibility access already granted." : "Requested Accessibility access."
        )
      )
    case ("reset", "accessibility"):
      let opened = openPrivacyPane(anchor: "Privacy_Accessibility")
      return SuccessEnvelope(
        data: PermissionResponse(
          target: target,
          action: action,
          granted: AXIsProcessTrusted(),
          requested: false,
          openedSettings: opened,
          message: "macOS requires Accessibility access to be changed manually in System Settings."
        )
      )
    case ("grant", "screen-recording"):
      let before = CGPreflightScreenCaptureAccess()
      let requested = !before
      let after = before || CGRequestScreenCaptureAccess()
      return SuccessEnvelope(
        data: PermissionResponse(
          target: target,
          action: action,
          granted: after,
          requested: requested,
          openedSettings: requested && !after ? openPrivacyPane(anchor: "Privacy_ScreenCapture") : false,
          message: after ? "Screen Recording access is available." : "Grant Screen Recording access in System Settings."
        )
      )
    case ("reset", "screen-recording"):
      let opened = openPrivacyPane(anchor: "Privacy_ScreenCapture")
      return SuccessEnvelope(
        data: PermissionResponse(
          target: target,
          action: action,
          granted: CGPreflightScreenCaptureAccess(),
          requested: false,
          openedSettings: opened,
          message: "macOS requires Screen Recording access to be changed manually in System Settings."
        )
      )
    case ("grant", "input-monitoring"):
      let before = CGPreflightPostEventAccess()
      let requested = !before
      let after = before || CGRequestPostEventAccess()
      return SuccessEnvelope(
        data: PermissionResponse(
          target: target,
          action: action,
          granted: after,
          requested: requested,
          openedSettings: requested && !after ? openPrivacyPane(anchor: "Privacy_ListenEvent") : false,
          message: after ? "Input Monitoring access is available." : "Grant Input Monitoring access in System Settings."
        )
      )
    case ("reset", "input-monitoring"):
      let opened = openPrivacyPane(anchor: "Privacy_ListenEvent")
      return SuccessEnvelope(
        data: PermissionResponse(
          target: target,
          action: action,
          granted: CGPreflightPostEventAccess(),
          requested: false,
          openedSettings: opened,
          message: "macOS requires Input Monitoring access to be changed manually in System Settings."
        )
      )
    default:
      throw HelperError.invalidArgs(
        "permission requires <grant|reset> <accessibility|screen-recording|input-monitoring>"
      )
    }
  }

  static func handleAlert(arguments: [String]) throws -> any Encodable {
    let action = arguments.first ?? "get"
    guard action == "get" || action == "accept" || action == "dismiss" else {
      throw HelperError.invalidArgs("alert requires get|accept|dismiss")
    }
    let bundleId = optionValue(arguments: Array(arguments.dropFirst()), name: "--bundle-id")
    let surface = optionValue(arguments: Array(arguments.dropFirst()), name: "--surface")
    let app = try resolveAlertApplication(bundleId: bundleId, surface: surface)
    guard let alertElement = findAlertElement(appElement: AXUIElementCreateApplication(app.processIdentifier)) else {
      throw HelperError.commandFailed(
        "alert not found",
        details: ["bundleId": app.bundleIdentifier ?? "", "appName": app.localizedName ?? ""]
      )
    }
    let buttons = collectButtons(root: alertElement)
    let labels = buttons.map(resolveElementLabel)
    let role = stringAttribute(alertElement, attribute: kAXRoleAttribute as String)
    let title =
      stringAttribute(alertElement, attribute: kAXTitleAttribute as String)
      ?? stringAttribute(alertElement, attribute: kAXDescriptionAttribute as String)

    if action == "accept" || action == "dismiss" {
      guard let button = resolveAlertActionButton(
        root: alertElement,
        buttons: buttons,
        action: action
      )
      else {
        throw HelperError.commandFailed("alert action failed", details: ["reason": "missing_button"])
      }
      let status = AXUIElementPerformAction(button, kAXPressAction as CFString)
      guard status == .success else {
        throw HelperError.commandFailed(
          "alert action failed",
          details: ["status": "\(status.rawValue)"]
        )
      }
    }

    return SuccessEnvelope(
      data: AlertResponse(
        title: title,
        role: role,
        buttons: labels,
        action: action == "get" ? nil : action,
        bundleId: app.bundleIdentifier
      )
    )
  }

  static func handleSnapshot(arguments: [String]) throws -> any Encodable {
    guard let surface = optionValue(arguments: arguments, name: "--surface")?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased(),
      !surface.isEmpty
    else {
      throw HelperError.invalidArgs("snapshot requires --surface <frontmost-app|desktop|menubar>")
    }

    switch surface {
    case "frontmost-app":
      let app = try resolveAlertApplication(bundleId: nil, surface: surface)
      return SuccessEnvelope(data: SnapshotResponse(surface: surface, nodes: snapshotFrontmostApp(app)))
    case "desktop":
      return SuccessEnvelope(data: SnapshotResponse(surface: surface, nodes: snapshotDesktop()))
    case "menubar":
      return SuccessEnvelope(data: SnapshotResponse(surface: surface, nodes: snapshotMenuBar()))
    default:
      throw HelperError.invalidArgs("snapshot requires --surface <frontmost-app|desktop|menubar>")
    }
  }
}

private func optionValue(arguments: [String], name: String) -> String? {
  guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
    return nil
  }
  return arguments[index + 1]
}

private func openPrivacyPane(anchor: String) -> Bool {
  if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)") {
    if NSWorkspace.shared.open(url) {
      return true
    }
  }
  if let appUrl = URL(string: "file:///System/Applications/System%20Settings.app") {
    return NSWorkspace.shared.open(appUrl)
  }
  return false
}

private func writeJSON<T: Encodable>(_ value: T) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  let data = try encoder.encode(value)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
}

private func resolveAlertApplication(bundleId: String?, surface: String?) throws -> NSRunningApplication {
  let normalizedSurface = surface?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  if normalizedSurface == "desktop" || normalizedSurface == "menubar" {
    throw HelperError.commandFailed(
      "alert surface is not supported yet",
      details: ["surface": normalizedSurface ?? ""]
    )
  }
  if normalizedSurface == "frontmost-app" {
    if let frontmost = NSWorkspace.shared.frontmostApplication {
      return frontmost
    }
    throw HelperError.commandFailed("unable to resolve frontmost app")
  }
  if let bundleId, !bundleId.isEmpty {
    let validatedBundleId = try validatedBundleId(bundleId)
    if let app = NSRunningApplication.runningApplications(withBundleIdentifier: validatedBundleId).first {
      return app
    }
    throw HelperError.commandFailed("app is not running", details: ["bundleId": validatedBundleId])
  }
  if let frontmost = NSWorkspace.shared.frontmostApplication {
    return frontmost
  }
  throw HelperError.commandFailed("unable to resolve target app")
}

private struct SnapshotContext {
  let surface: String
  let pid: Int32?
  let bundleId: String?
  let appName: String?
  let windowTitle: String?
}

private func snapshotFrontmostApp(_ app: NSRunningApplication) -> [SnapshotNodeResponse] {
  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  var nodes: [SnapshotNodeResponse] = []
  var visited = Set<CFHashCode>()
  appendElementSnapshot(
    appElement,
    depth: 0,
    parentIndex: nil,
    context: SnapshotContext(
      surface: "frontmost-app",
      pid: Int32(app.processIdentifier),
      bundleId: app.bundleIdentifier,
      appName: app.localizedName,
      windowTitle: nil
    ),
    nodes: &nodes,
    visited: &visited
  )
  return nodes
}

private func snapshotDesktop() -> [SnapshotNodeResponse] {
  var nodes: [SnapshotNodeResponse] = []
  let rootIndex = appendSyntheticSnapshotNode(
    into: &nodes,
    type: "DesktopSurface",
    label: "Desktop",
    depth: 0,
    parentIndex: nil,
    surface: "desktop"
  )

  var runningApps = NSWorkspace.shared.runningApplications.filter { app in
    app.activationPolicy != .prohibited
      && !app.isTerminated
      && (app.bundleIdentifier?.isEmpty == false || app.localizedName?.isEmpty == false)
  }
  runningApps.sort { left, right in
    if left.isActive != right.isActive {
      return left.isActive && !right.isActive
    }
    return (left.localizedName ?? "") < (right.localizedName ?? "")
  }

  for app in runningApps {
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    let visibleWindows = windows(of: appElement).filter(isVisibleSnapshotWindow)
    if visibleWindows.isEmpty {
      continue
    }
    let appIndex = appendSyntheticSnapshotNode(
      into: &nodes,
      type: "Application",
      label: app.localizedName ?? app.bundleIdentifier ?? "Application",
      depth: 1,
      parentIndex: rootIndex,
      surface: "desktop",
      identifier: app.bundleIdentifier,
      pid: Int32(app.processIdentifier),
      bundleId: app.bundleIdentifier,
      appName: app.localizedName
    )
    var visited = Set<CFHashCode>()
    for window in visibleWindows {
      let windowTitle = stringAttribute(window, attribute: kAXTitleAttribute as String)
      appendElementSnapshot(
        window,
        depth: 2,
        parentIndex: appIndex,
        context: SnapshotContext(
          surface: "desktop",
          pid: Int32(app.processIdentifier),
          bundleId: app.bundleIdentifier,
          appName: app.localizedName,
          windowTitle: windowTitle
        ),
        nodes: &nodes,
        visited: &visited
      )
    }
  }

  return nodes
}

private func snapshotMenuBar() -> [SnapshotNodeResponse] {
  var nodes: [SnapshotNodeResponse] = []
  let rootIndex = appendSyntheticSnapshotNode(
    into: &nodes,
    type: "MenuBarSurface",
    label: "Menu Bar",
    depth: 0,
    parentIndex: nil,
    surface: "menubar"
  )

  if let frontmost = NSWorkspace.shared.frontmostApplication {
    let frontmostElement = AXUIElementCreateApplication(frontmost.processIdentifier)
    if let menuBar = elementAttribute(frontmostElement, attribute: kAXMenuBarAttribute as String) {
      var frontmostVisited = Set<CFHashCode>()
      appendElementSnapshot(
        menuBar,
        depth: 1,
        parentIndex: rootIndex,
        context: SnapshotContext(
          surface: "menubar",
          pid: Int32(frontmost.processIdentifier),
          bundleId: frontmost.bundleIdentifier,
          appName: frontmost.localizedName,
          windowTitle: frontmost.localizedName
        ),
        nodes: &nodes,
        visited: &frontmostVisited
      )
    }
  }

  if let systemUiServer = NSRunningApplication.runningApplications(
    withBundleIdentifier: "com.apple.systemuiserver"
  ).first {
    let systemUiElement = AXUIElementCreateApplication(systemUiServer.processIdentifier)
    if let menuExtras = elementAttribute(systemUiElement, attribute: kAXMenuBarAttribute as String) {
      var systemUiVisited = Set<CFHashCode>()
      appendElementSnapshot(
        menuExtras,
        depth: 1,
        parentIndex: rootIndex,
        context: SnapshotContext(
          surface: "menubar",
          pid: Int32(systemUiServer.processIdentifier),
          bundleId: systemUiServer.bundleIdentifier,
          appName: systemUiServer.localizedName,
          windowTitle: "System Menu Extras"
        ),
        nodes: &nodes,
        visited: &systemUiVisited
      )
    }
  }

  return nodes
}

@discardableResult
private func appendSyntheticSnapshotNode(
  into nodes: inout [SnapshotNodeResponse],
  type: String,
  label: String,
  depth: Int,
  parentIndex: Int?,
  surface: String,
  identifier: String? = nil,
  pid: Int32? = nil,
  bundleId: String? = nil,
  appName: String? = nil,
  windowTitle: String? = nil
) -> Int {
  let index = nodes.count
  nodes.append(
    SnapshotNodeResponse(
      index: index,
      type: type,
      role: type,
      subrole: nil,
      label: label,
      value: nil,
      identifier: identifier ?? "surface:\(surface):\(type.lowercased())",
      rect: nil,
      enabled: true,
      selected: nil,
      hittable: false,
      depth: depth,
      parentIndex: parentIndex,
      pid: pid,
      bundleId: bundleId,
      appName: appName,
      windowTitle: windowTitle,
      surface: surface
    )
  )
  return index
}

@discardableResult
private func appendElementSnapshot(
  _ element: AXUIElement,
  depth: Int,
  parentIndex: Int?,
  context: SnapshotContext,
  nodes: inout [SnapshotNodeResponse],
  visited: inout Set<CFHashCode>,
  maxDepth: Int = 12
) -> Int {
  let elementHash = CFHash(element)
  if visited.contains(elementHash) {
    return parentIndex ?? 0
  }
  visited.insert(elementHash)

  let role = stringAttribute(element, attribute: kAXRoleAttribute as String)
  let subrole = stringAttribute(element, attribute: kAXSubroleAttribute as String)
  let title = stringAttribute(element, attribute: kAXTitleAttribute as String)
  let description = stringAttribute(element, attribute: kAXDescriptionAttribute as String)
  let value = stringAttribute(element, attribute: kAXValueAttribute as String)
  let identifier = stringAttribute(element, attribute: "AXIdentifier")
  let rect = rectAttribute(element)
  let enabled = boolAttribute(element, attribute: kAXEnabledAttribute as String)
  let selected = boolAttribute(element, attribute: kAXSelectedAttribute as String)
  let type = normalizedSnapshotType(role: role, subrole: subrole)
  let windowTitle = context.windowTitle ?? inferWindowTitle(for: element)

  let index = nodes.count
  nodes.append(
    SnapshotNodeResponse(
      index: index,
      type: type,
      role: role,
      subrole: subrole,
      label: title ?? description ?? value,
      value: value,
      identifier: identifier,
      rect: rect,
      enabled: enabled,
      selected: selected,
      hittable: (enabled ?? true) && rect != nil,
      depth: depth,
      parentIndex: parentIndex,
      pid: context.pid,
      bundleId: context.bundleId,
      appName: context.appName,
      windowTitle: windowTitle,
      surface: context.surface
    )
  )

  guard depth < maxDepth else {
    return index
  }

  for child in children(of: element) {
    appendElementSnapshot(
      child,
      depth: depth + 1,
      parentIndex: index,
      context: SnapshotContext(
        surface: context.surface,
        pid: context.pid,
        bundleId: context.bundleId,
        appName: context.appName,
        windowTitle: windowTitle
      ),
      nodes: &nodes,
      visited: &visited,
      maxDepth: maxDepth
    )
  }

  return index
}

private func normalizedSnapshotType(role: String?, subrole: String?) -> String? {
  switch role {
  case "AXApplication":
    return "Application"
  case "AXWindow":
    return subrole == "AXStandardWindow" ? "Window" : (subrole ?? "Window")
  case "AXSheet":
    return "Sheet"
  case "AXDialog":
    return "Dialog"
  case "AXButton":
    return "Button"
  case "AXStaticText":
    return "StaticText"
  case "AXTextField":
    return "TextField"
  case "AXTextArea":
    return "TextArea"
  case "AXScrollArea":
    return "ScrollArea"
  case "AXGroup":
    return "Group"
  case "AXMenuBar":
    return "MenuBar"
  case "AXMenuBarItem":
    return "MenuBarItem"
  case "AXMenu":
    return "Menu"
  case "AXMenuItem":
    return "MenuItem"
  default:
    if let subrole, !subrole.isEmpty {
      return subrole
    }
    return role
  }
}

private func isVisibleSnapshotWindow(_ window: AXUIElement) -> Bool {
  guard let rect = rectAttribute(window) else {
    return false
  }
  if rect.width <= 0 || rect.height <= 0 {
    return false
  }
  if boolAttribute(window, attribute: kAXMinimizedAttribute as String) == true {
    return false
  }
  return true
}

private func inferWindowTitle(for element: AXUIElement) -> String? {
  if let title = stringAttribute(element, attribute: kAXTitleAttribute as String) {
    return title
  }
  if let window = elementAttribute(element, attribute: kAXWindowAttribute as String) {
    return stringAttribute(window, attribute: kAXTitleAttribute as String)
  }
  return nil
}

private func validatedBundleId(_ rawBundleId: String) throws -> String {
  let bundleId = rawBundleId.trimmingCharacters(in: .whitespacesAndNewlines)
  let pattern = #"^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$"#
  guard bundleId.range(of: pattern, options: .regularExpression) != nil else {
    throw HelperError.invalidArgs("bundle id must use reverse-DNS form like com.example.App")
  }
  return bundleId
}

private func stringAttribute(_ element: AXUIElement, attribute: String) -> String? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
    return nil
  }
  if let text = value as? String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
  return nil
}

private func boolAttribute(_ element: AXUIElement, attribute: String) -> Bool? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
        let number = value as? NSNumber
  else {
    return nil
  }
  return number.boolValue
}

private func elementAttribute(_ element: AXUIElement, attribute: String) -> AXUIElement? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
    return nil
  }
  guard let value else {
    return nil
  }
  return unsafeBitCast(value, to: AXUIElement.self)
}

private func rectAttribute(_ element: AXUIElement) -> RectResponse? {
  var positionValue: CFTypeRef?
  var sizeValue: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue) == .success,
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success,
        let axPosition = positionValue,
        let axSize = sizeValue
  else {
    return nil
  }

  var position = CGPoint.zero
  var size = CGSize.zero
  guard AXValueGetType(axPosition as! AXValue) == .cgPoint,
        AXValueGetValue(axPosition as! AXValue, .cgPoint, &position),
        AXValueGetType(axSize as! AXValue) == .cgSize,
        AXValueGetValue(axSize as! AXValue, .cgSize, &size)
  else {
    return nil
  }

  return RectResponse(
    x: Double(position.x),
    y: Double(position.y),
    width: Double(size.width),
    height: Double(size.height)
  )
}

private func children(of element: AXUIElement) -> [AXUIElement] {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
        let children = value as? [AXUIElement]
  else {
    return []
  }
  return children
}

private func windows(of appElement: AXUIElement) -> [AXUIElement] {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(appElement, "AXWindows" as CFString, &value) == .success,
        let windows = value as? [AXUIElement]
  else {
    return []
  }
  return windows
}

private func findAlertElement(appElement: AXUIElement) -> AXUIElement? {
  for window in windows(of: appElement) {
    if let role = stringAttribute(window, attribute: kAXRoleAttribute as String),
       role == "AXSheet" || role == "AXDialog"
    {
      return window
    }
    if let nested = findAlertElementRecursively(root: window, depth: 0) {
      return nested
    }
  }
  return nil
}

private func findAlertElementRecursively(root: AXUIElement, depth: Int) -> AXUIElement? {
  if depth > 4 {
    return nil
  }
  for child in children(of: root) {
    if let role = stringAttribute(child, attribute: kAXRoleAttribute as String),
       role == "AXSheet" || role == "AXDialog"
    {
      return child
    }
    if let nested = findAlertElementRecursively(root: child, depth: depth + 1) {
      return nested
    }
  }
  return nil
}

private func collectButtons(root: AXUIElement) -> [AXUIElement] {
  var buttons: [AXUIElement] = []
  collectButtons(root: root, depth: 0, results: &buttons)
  return buttons
}

private func collectButtons(root: AXUIElement, depth: Int, results: inout [AXUIElement]) {
  if depth > 5 {
    return
  }
  if stringAttribute(root, attribute: kAXRoleAttribute as String) == "AXButton" {
    results.append(root)
  }
  for child in children(of: root) {
    collectButtons(root: child, depth: depth + 1, results: &results)
  }
}

private func resolveElementLabel(_ element: AXUIElement) -> String {
  return
    stringAttribute(element, attribute: kAXTitleAttribute as String)
    ?? stringAttribute(element, attribute: kAXDescriptionAttribute as String)
    ?? stringAttribute(element, attribute: kAXValueAttribute as String)
    ?? "button"
}

private func resolveAlertActionButton(root: AXUIElement, buttons: [AXUIElement], action: String) -> AXUIElement? {
  if action == "accept",
     let defaultButton = elementAttribute(root, attribute: kAXDefaultButtonAttribute as String)
  {
    return defaultButton
  }
  if action == "dismiss",
     let cancelButton = elementAttribute(root, attribute: kAXCancelButtonAttribute as String)
  {
    return cancelButton
  }

  let buttonEntries = buttons.map { (element: $0, label: resolveElementLabel($0).lowercased()) }
  let preferredLabels =
    action == "accept"
    ? ["allow", "ok", "open", "continue", "yes", "save", "install", "trust", "enable"]
    : ["don't allow", "deny", "cancel", "not now", "no", "close", "later", "ignore"]

  for preferredLabel in preferredLabels {
    if let match = buttonEntries.first(where: { $0.label.contains(preferredLabel) }) {
      return match.element
    }
  }

  return action == "accept" ? buttons.first : buttons.last
}
