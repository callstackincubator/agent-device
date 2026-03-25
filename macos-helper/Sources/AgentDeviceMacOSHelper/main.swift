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

struct ReadResponse: Encodable {
  let text: String
}

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
    case "read":
      return try handleRead(arguments: Array(arguments.dropFirst()))
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
    let app = try resolveTargetApplication(bundleId: bundleId, surface: surface)
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
      return SuccessEnvelope(data: try captureSnapshotResponse(surface: surface))
    case "desktop", "menubar":
      return SuccessEnvelope(data: try captureSnapshotResponse(surface: surface))
    default:
      throw HelperError.invalidArgs("snapshot requires --surface <frontmost-app|desktop|menubar>")
    }
  }

  static func handleRead(arguments: [String]) throws -> any Encodable {
    guard let rawX = optionValue(arguments: arguments, name: "--x"),
          let rawY = optionValue(arguments: arguments, name: "--y"),
          let x = Double(rawX),
          let y = Double(rawY)
    else {
      throw HelperError.invalidArgs("read requires --x <number> --y <number>")
    }

    let bundleId = optionValue(arguments: arguments, name: "--bundle-id")
    let surface = optionValue(arguments: arguments, name: "--surface")
    let text = try readTextAtPosition(bundleId: bundleId, surface: surface, x: x, y: y)
    return SuccessEnvelope(data: ReadResponse(text: text))
  }
}

private func optionValue(arguments: [String], name: String) -> String? {
  guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
    return nil
  }
  return arguments[index + 1]
}

private func readTextAtPosition(bundleId: String?, surface: String?, x: Double, y: Double) throws -> String {
  if surface == "frontmost-app" || (surface == nil && bundleId != nil) {
    _ = try resolveTargetApplication(bundleId: bundleId, surface: surface)
  }

  let systemWide = AXUIElementCreateSystemWide()
  var hitElement: AXUIElement?
  guard AXUIElementCopyElementAtPosition(systemWide, Float(x), Float(y), &hitElement) == .success,
        let hitElement
  else {
    throw HelperError.commandFailed("read did not resolve an accessibility element")
  }

  var current: AXUIElement? = hitElement
  var depth = 0
  while let element = current, depth < 8 {
    if let text = readableText(for: element) {
      return text
    }
    current = elementAttribute(element, attribute: kAXParentAttribute as String)
    depth += 1
  }

  throw HelperError.commandFailed("read did not resolve text")
}

private func readableText(for element: AXUIElement) -> String? {
  return
    stringAttribute(element, attribute: kAXValueAttribute as String)
    ?? stringAttribute(element, attribute: kAXTitleAttribute as String)
    ?? stringAttribute(element, attribute: kAXDescriptionAttribute as String)
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

func resolveTargetApplication(bundleId: String?, surface: String?) throws -> NSRunningApplication {
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

private func validatedBundleId(_ rawBundleId: String) throws -> String {
  let bundleId = rawBundleId.trimmingCharacters(in: .whitespacesAndNewlines)
  let pattern = #"^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$"#
  guard bundleId.range(of: pattern, options: .regularExpression) != nil else {
    throw HelperError.invalidArgs("bundle id must use reverse-DNS form like com.example.App")
  }
  return bundleId
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

AgentDeviceMacOSHelper.main()
