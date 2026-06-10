import XCTest

extension RunnerTests {
  private static let privateAXSnapshotMaxNodes = 5_000

  func privateAXSnapshotFallback(
    app: XCUIApplication,
    options: SnapshotOptions,
    reason: String
  ) -> DataPayload? {
    #if os(iOS) && targetEnvironment(simulator)
      let maxDepth = options.depth ?? 64
      let response = RunnerAXSnapshotBridge.snapshotTree(
        for: app,
        maxDepth: maxDepth,
        maxNodes: Self.privateAXSnapshotMaxNodes
      )
      guard response["ok"] as? Bool == true else {
        let error = response["error"] as? String ?? "unknown private AX snapshot failure"
        NSLog("AGENT_DEVICE_RUNNER_PRIVATE_AX_SNAPSHOT_FAILED=%@", error)
        return nil
      }
      guard let root = response["root"] as? [String: Any] else {
        NSLog("AGENT_DEVICE_RUNNER_PRIVATE_AX_SNAPSHOT_FAILED=missing root")
        return nil
      }

      let viewport = safeSnapshotViewport(app: app)
      var nodes: [SnapshotNode] = []
      appendPrivateAXNode(
        root,
        to: &nodes,
        options: options,
        viewport: viewport,
        depth: 0,
        parentIndex: nil
      )
      if nodes.count <= 1 {
        NSLog("AGENT_DEVICE_RUNNER_PRIVATE_AX_SNAPSHOT_SPARSE=%ld", nodes.count)
        return nil
      }

      let truncated = (response["truncated"] as? Bool) == true
      let message =
        "Recovered iOS snapshot with private AX fallback after \(reason). This backend is simulator-only, experimental, and may expose a partial tree."
      NSLog(
        "AGENT_DEVICE_RUNNER_PRIVATE_AX_SNAPSHOT_USED reason=%@ nodes=%ld truncated=%@",
        reason,
        nodes.count,
        truncated ? "true" : "false"
      )
      return DataPayload(message: message, nodes: nodes, truncated: truncated)
    #else
      return nil
    #endif
  }

  private func appendPrivateAXNode(
    _ rawNode: [String: Any],
    to nodes: inout [SnapshotNode],
    options: SnapshotOptions,
    viewport: CGRect,
    depth: Int,
    parentIndex: Int?
  ) {
    if let limit = options.depth, depth > limit { return }

    let rect = privateAXRect(rawNode["frame"])
    let label = privateAXString(rawNode["label"])
    let identifier = privateAXString(rawNode["identifier"])
    let value = privateAXString(rawNode["value"])
    let rawType = privateAXInt(rawNode["type"]) ?? 0
    let typeName = elementTypeName(rawElementType: rawType)
    let enabled = privateAXBool(rawNode["enabled"]) ?? true
    let visible = isVisibleInViewport(rect, viewport)
    let hasContent = !label.isEmpty || !identifier.isEmpty || !value.isEmpty
    let isRoot = parentIndex == nil

    let include: Bool
    if isRoot {
      include = true
    } else if options.interactiveOnly && !visible {
      include = false
    } else if let scope = options.scope?.trimmingCharacters(in: .whitespacesAndNewlines), !scope.isEmpty {
      let haystack = [label, identifier, value].joined(separator: "\n")
      include = haystack.localizedCaseInsensitiveContains(scope)
    } else if options.compact {
      include = hasContent || privateAXLikelyInteractive(rawElementType: rawType)
    } else {
      include = true
    }

    let currentIndex: Int?
    if include {
      currentIndex = nodes.count
      nodes.append(
        SnapshotNode(
          index: nodes.count,
          type: typeName,
          label: label.isEmpty ? nil : label,
          identifier: identifier.isEmpty ? nil : identifier,
          value: value.isEmpty ? nil : value,
          rect: snapshotRect(from: rect),
          enabled: enabled,
          focused: privateAXBool(rawNode["focused"]) == true ? true : nil,
          selected: privateAXBool(rawNode["selected"]) == true ? true : nil,
          hittable: visible && enabled && privateAXLikelyInteractive(rawElementType: rawType),
          depth: depth,
          parentIndex: parentIndex,
          hiddenContentAbove: nil,
          hiddenContentBelow: nil
        )
      )
    } else {
      currentIndex = parentIndex
    }

    guard let children = rawNode["children"] as? [[String: Any]] else {
      return
    }
    for child in children {
      appendPrivateAXNode(
        child,
        to: &nodes,
        options: options,
        viewport: viewport,
        depth: depth + 1,
        parentIndex: currentIndex
      )
    }
  }

  private func elementTypeName(rawElementType: Int) -> String {
    if let type = XCUIElement.ElementType(rawValue: UInt(rawElementType)) {
      return elementTypeName(type)
    }
    return "Element(\(rawElementType))"
  }

  private func privateAXLikelyInteractive(rawElementType: Int) -> Bool {
    guard let type = XCUIElement.ElementType(rawValue: UInt(rawElementType)) else {
      return false
    }
    return interactiveTypes.contains(type) || Self.scrollContainerTypes.contains(type)
  }

  private func privateAXString(_ value: Any?) -> String {
    guard let value else { return "" }
    if let string = value as? String {
      return string.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func privateAXInt(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? NSNumber { return value.intValue }
    return nil
  }

  private func privateAXBool(_ value: Any?) -> Bool? {
    if let value = value as? Bool { return value }
    if let value = value as? NSNumber { return value.boolValue }
    return nil
  }

  private func privateAXRect(_ value: Any?) -> CGRect {
    guard let frame = value as? [String: Any] else {
      return .zero
    }
    return CGRect(
      x: privateAXDouble(frame["x"]) ?? 0,
      y: privateAXDouble(frame["y"]) ?? 0,
      width: privateAXDouble(frame["width"]) ?? 0,
      height: privateAXDouble(frame["height"]) ?? 0
    )
  }

  private func privateAXDouble(_ value: Any?) -> Double? {
    if let value = value as? Double { return value }
    if let value = value as? NSNumber { return value.doubleValue }
    return nil
  }
}
