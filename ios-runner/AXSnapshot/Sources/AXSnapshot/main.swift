import Foundation
import ApplicationServices
import Cocoa

struct AXNode: Codable {
    struct Frame: Codable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    let role: String?
    let subrole: String?
    let label: String?
    let value: String?
    let identifier: String?
    let frame: Frame?
    let children: [AXNode]
}

struct AXSnapshot: Codable {
    let windowFrame: AXNode.Frame?
    let root: AXNode
}

struct AXSnapshotError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

let simulatorBundleId = "com.apple.iphonesimulator"

func hasAccessibilityPermission() -> Bool {
    AXIsProcessTrusted()
}

func findSimulatorApp() -> NSRunningApplication? {
    NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == simulatorBundleId }
}

func axElement(for app: NSRunningApplication) -> AXUIElement {
    AXUIElementCreateApplication(app.processIdentifier)
}

func getAttribute<T>(_ element: AXUIElement, _ attribute: CFString) -> T? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute, &value)
    guard result == .success else { return nil }
    return value as? T
}

func getChildren(_ element: AXUIElement) -> [AXUIElement] {
    getAttribute(element, kAXChildrenAttribute as CFString) ?? []
}

func getRole(_ element: AXUIElement) -> String? {
    getAttribute(element, kAXRoleAttribute as CFString)
}

func getSubrole(_ element: AXUIElement) -> String? {
    getAttribute(element, kAXSubroleAttribute as CFString)
}

func getLabel(_ element: AXUIElement) -> String? {
    if let label: String = getAttribute(element, "AXLabel" as CFString) {
        return label
    }
    if let desc: String = getAttribute(element, kAXDescriptionAttribute as CFString) {
        return desc
    }
    return nil
}

func getValue(_ element: AXUIElement) -> String? {
    if let value: String = getAttribute(element, kAXValueAttribute as CFString) {
        return value
    }
    if let number: NSNumber = getAttribute(element, kAXValueAttribute as CFString) {
        return number.stringValue
    }
    return nil
}

func getIdentifier(_ element: AXUIElement) -> String? {
    getAttribute(element, kAXIdentifierAttribute as CFString)
}

func getFrame(_ element: AXUIElement) -> AXNode.Frame? {
    var positionRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionRef)
    AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef)
    guard let posValue = positionRef, let sizeValue = sizeRef else {
        return nil
    }
    if CFGetTypeID(posValue) != AXValueGetTypeID() || CFGetTypeID(sizeValue) != AXValueGetTypeID() {
        return nil
    }
    let posAx = posValue as! AXValue
    let sizeAx = sizeValue as! AXValue
    var point = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(posAx, .cgPoint, &point)
    AXValueGetValue(sizeAx, .cgSize, &size)
    return AXNode.Frame(
        x: Double(point.x),
        y: Double(point.y),
        width: Double(size.width),
        height: Double(size.height)
    )
}

func buildTree(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 40) -> AXNode {
    let children = depth < maxDepth ? getChildren(element).map { buildTree($0, depth: depth + 1, maxDepth: maxDepth) } : []
    return AXNode(
        role: getRole(element),
        subrole: getSubrole(element),
        label: getLabel(element),
        value: getValue(element),
        identifier: getIdentifier(element),
        frame: getFrame(element),
        children: children
    )
}

func findIOSAppRoot(in simulator: NSRunningApplication) -> (AXUIElement, AXNode.Frame?)? {
    let appElement = axElement(for: simulator)
    let windows = getChildren(appElement).filter { getRole($0) == "AXWindow" }
    for window in windows {
        for child in getChildren(window) {
            if getRole(child) == "AXGroup" {
                return (child, getFrame(window))
            }
        }
    }
    return nil
}

func main() throws {
    guard hasAccessibilityPermission() else {
        throw AXSnapshotError(message: "Accessibility permission not granted. Enable it in System Settings > Privacy & Security > Accessibility.")
    }
    guard let simulator = findSimulatorApp() else {
        throw AXSnapshotError(message: "iOS Simulator is not running.")
    }
    guard let (root, windowFrame) = findIOSAppRoot(in: simulator) else {
        throw AXSnapshotError(message: "Could not find iOS app content in Simulator.")
    }
    let tree = buildTree(root)
    let snapshot = AXSnapshot(windowFrame: windowFrame, root: tree)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(snapshot)
    if let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        throw AXSnapshotError(message: "Failed to encode AX snapshot JSON.")
    }
}

do {
    try main()
} catch {
    fputs("axsnapshot error: \(error)\n", stderr)
    exit(1)
}
