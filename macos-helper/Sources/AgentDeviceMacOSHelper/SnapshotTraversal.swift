import AppKit
import ApplicationServices
import Foundation

private enum SnapshotTraversalLimits {
  static let maxDesktopApps = 24
  static let maxNodes = 1500
  static let maxDepth = 12
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
  let truncated: Bool
  let backend = "macos-helper"
}

private struct SnapshotBuildResult {
  let nodes: [SnapshotNodeResponse]
  let truncated: Bool
}

private struct SnapshotContext {
  let surface: String
  let pid: Int32?
  let bundleId: String?
  let appName: String?
  let windowTitle: String?
}

private struct SnapshotTraversalState {
  var nodes: [SnapshotNodeResponse] = []
  var visited: [AXUIElement] = []
  var truncated = false
}

func captureSnapshotResponse(surface: String) throws -> SnapshotResponse {
  let result: SnapshotBuildResult
  switch surface {
  case "frontmost-app":
    result = try snapshotFrontmostApp()
  case "desktop":
    result = snapshotDesktop()
  case "menubar":
    result = snapshotMenuBar()
  default:
    throw HelperError.invalidArgs("snapshot requires --surface <frontmost-app|desktop|menubar>")
  }

  return SnapshotResponse(surface: surface, nodes: result.nodes, truncated: result.truncated)
}

private func snapshotFrontmostApp() throws -> SnapshotBuildResult {
  let app = try resolveTargetApplication(bundleId: nil, surface: "frontmost-app")
  var state = SnapshotTraversalState()
  _ = appendApplicationSnapshot(
    app,
    depth: 0,
    parentIndex: nil,
    surface: "frontmost-app",
    state: &state
  )
  return SnapshotBuildResult(nodes: state.nodes, truncated: state.truncated)
}

private func snapshotDesktop() -> SnapshotBuildResult {
  var state = SnapshotTraversalState()
  guard
    let rootIndex = appendSyntheticSnapshotNode(
      into: &state,
      type: "DesktopSurface",
      label: "Desktop",
      depth: 0,
      parentIndex: nil,
      surface: "desktop"
    )
  else {
    return SnapshotBuildResult(nodes: state.nodes, truncated: true)
  }

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

  var includedApps = 0
  for app in runningApps {
    if includedApps >= SnapshotTraversalLimits.maxDesktopApps {
      state.truncated = true
      break
    }
    if state.truncated {
      break
    }

    let included = appendApplicationSnapshot(
      app,
      depth: 1,
      parentIndex: rootIndex,
      surface: "desktop",
      state: &state
    )
    if state.truncated {
      break
    }
    if included {
      includedApps += 1
    }
  }

  return SnapshotBuildResult(nodes: state.nodes, truncated: state.truncated)
}

@discardableResult
private func appendApplicationSnapshot(
  _ app: NSRunningApplication,
  depth: Int,
  parentIndex: Int?,
  surface: String,
  state: inout SnapshotTraversalState
) -> Bool {
  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  let visibleWindows = windows(of: appElement).filter(isVisibleSnapshotWindow)
  if visibleWindows.isEmpty {
    return false
  }

  guard
    let appIndex = appendSyntheticSnapshotNode(
      into: &state,
      type: "Application",
      label: app.localizedName ?? app.bundleIdentifier ?? "Application",
      depth: depth,
      parentIndex: parentIndex,
      surface: surface,
      identifier: app.bundleIdentifier,
      pid: Int32(app.processIdentifier),
      bundleId: app.bundleIdentifier,
      appName: app.localizedName
    )
  else {
    return false
  }

  for window in visibleWindows {
    if state.truncated {
      break
    }
    let windowTitle = stringAttribute(window, attribute: kAXTitleAttribute as String)
    _ = appendElementSnapshot(
      window,
      depth: depth + 1,
      parentIndex: appIndex,
      context: SnapshotContext(
        surface: surface,
        pid: Int32(app.processIdentifier),
        bundleId: app.bundleIdentifier,
        appName: app.localizedName,
        windowTitle: windowTitle
      ),
      state: &state
    )
  }

  return true
}

private func snapshotMenuBar() -> SnapshotBuildResult {
  var state = SnapshotTraversalState()
  guard
    let rootIndex = appendSyntheticSnapshotNode(
      into: &state,
      type: "MenuBarSurface",
      label: "Menu Bar",
      depth: 0,
      parentIndex: nil,
      surface: "menubar"
    )
  else {
    return SnapshotBuildResult(nodes: state.nodes, truncated: true)
  }

  if let frontmost = NSWorkspace.shared.frontmostApplication {
    let frontmostElement = AXUIElementCreateApplication(frontmost.processIdentifier)
    if let menuBar = elementAttribute(frontmostElement, attribute: kAXMenuBarAttribute as String) {
      _ = appendElementSnapshot(
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
        state: &state
      )
    }
  }

  if !state.truncated,
     let systemUiServer = NSRunningApplication.runningApplications(
       withBundleIdentifier: "com.apple.systemuiserver"
     ).first
  {
    let systemUiElement = AXUIElementCreateApplication(systemUiServer.processIdentifier)
    if let menuExtras = elementAttribute(systemUiElement, attribute: kAXMenuBarAttribute as String) {
      _ = appendElementSnapshot(
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
        state: &state
      )
    }
  }

  return SnapshotBuildResult(nodes: state.nodes, truncated: state.truncated)
}

@discardableResult
private func appendSyntheticSnapshotNode(
  into state: inout SnapshotTraversalState,
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
) -> Int? {
  guard reserveSnapshotNodeCapacity(&state) else {
    return nil
  }

  let index = state.nodes.count
  state.nodes.append(
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
  state: inout SnapshotTraversalState,
  maxDepth: Int = SnapshotTraversalLimits.maxDepth
) -> Int? {
  if state.visited.contains(where: { CFEqual($0, element) }) {
    return parentIndex
  }
  guard reserveSnapshotNodeCapacity(&state) else {
    return parentIndex
  }
  state.visited.append(element)

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

  let index = state.nodes.count
  state.nodes.append(
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

  guard depth < maxDepth, !state.truncated else {
    return index
  }

  for child in children(of: element) {
    if state.truncated {
      break
    }
    _ = appendElementSnapshot(
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
      state: &state,
      maxDepth: maxDepth
    )
  }

  return index
}

private func reserveSnapshotNodeCapacity(_ state: inout SnapshotTraversalState) -> Bool {
  if state.nodes.count >= SnapshotTraversalLimits.maxNodes {
    state.truncated = true
    return false
  }
  return true
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

func stringAttribute(_ element: AXUIElement, attribute: String) -> String? {
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

func boolAttribute(_ element: AXUIElement, attribute: String) -> Bool? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
        let number = value as? NSNumber
  else {
    return nil
  }
  return number.boolValue
}

func elementAttribute(_ element: AXUIElement, attribute: String) -> AXUIElement? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
        let value,
        CFGetTypeID(value) == AXUIElementGetTypeID()
  else {
    return nil
  }
  return (value as! AXUIElement)
}

func rectAttribute(_ element: AXUIElement) -> RectResponse? {
  var positionValue: CFTypeRef?
  var sizeValue: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue) == .success,
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success,
        let positionAxValue = accessibilityAxValue(positionValue),
        let sizeAxValue = accessibilityAxValue(sizeValue)
  else {
    return nil
  }

  var position = CGPoint.zero
  var size = CGSize.zero
  guard AXValueGetType(positionAxValue) == .cgPoint,
        AXValueGetValue(positionAxValue, .cgPoint, &position),
        AXValueGetType(sizeAxValue) == .cgSize,
        AXValueGetValue(sizeAxValue, .cgSize, &size)
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

private func accessibilityAxValue(_ value: CFTypeRef?) -> AXValue? {
  guard let value, CFGetTypeID(value) == AXValueGetTypeID() else {
    return nil
  }
  return (value as! AXValue)
}

func children(of element: AXUIElement) -> [AXUIElement] {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
        let children = value as? [AXUIElement]
  else {
    return []
  }
  return children
}

func windows(of appElement: AXUIElement) -> [AXUIElement] {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(appElement, "AXWindows" as CFString, &value) == .success,
        let windows = value as? [AXUIElement]
  else {
    return []
  }
  return windows
}
