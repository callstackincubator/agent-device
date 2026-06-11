import XCTest

extension RunnerTests {
  private static let privateAXSnapshotMaxNodes = 5_000
  /// Deep React Native trees make the AX server reject bulk snapshot requests outright with
  /// kAXErrorIllegalArgument once the requested depth crosses a tree-size-dependent limit
  /// (observed between depth 56 and 64 on the Bluesky Home feed; the limit moves with live
  /// content). Retrying the same request at a shallower depth succeeds, so on failure we walk
  /// this ladder instead of giving up. Capped at 4 attempts to bound worst-case latency on
  /// apps where the AX surface is genuinely unavailable.
  static let privateAXSnapshotDepthLadder = [56, 40, 24, 12]

  func privateAXSnapshotCapture(
    app: XCUIApplication,
    options: SnapshotOptions
  ) -> SnapshotBackendCapture? {
    #if os(iOS) && targetEnvironment(simulator)
      let requestedDepth = options.depth ?? 64
      var attemptDepths = [requestedDepth]
      attemptDepths.append(
        contentsOf: Self.privateAXSnapshotDepthLadder.filter { $0 < requestedDepth }
      )
      var response: [String: Any] = [:]
      var effectiveDepth = requestedDepth
      var lastError = "unknown private AX snapshot failure"
      for depth in attemptDepths {
        response = RunnerAXSnapshotBridge.snapshotTree(
          for: app,
          maxDepth: depth,
          maxNodes: Self.privateAXSnapshotMaxNodes
        )
        if response["ok"] as? Bool == true {
          effectiveDepth = depth
          break
        }
        lastError = response["error"] as? String ?? lastError
        NSLog(
          "AGENT_DEVICE_RUNNER_PRIVATE_AX_SNAPSHOT_DEPTH_RETRY depth=%ld error=%@",
          depth,
          lastError
        )
      }
      guard response["ok"] as? Bool == true else {
        NSLog("AGENT_DEVICE_RUNNER_PRIVATE_AX_SNAPSHOT_FAILED=%@", lastError)
        return nil
      }
      guard let root = response["root"] as? [String: Any] else {
        NSLog("AGENT_DEVICE_RUNNER_PRIVATE_AX_SNAPSHOT_FAILED=missing root")
        return nil
      }

      // The public windows query backing safeSnapshotViewport can fail on the same apps that
      // need this fallback, degrading to an infinite viewport that marks off-screen content
      // (e.g. closed drawer menus at negative x) as visible and tappable. The private root's
      // own frame is the reliable screen rect here.
      var viewport = safeSnapshotViewport(app: app)
      let rootFrame = privateAXRect(root["frame"])
      if viewport.isInfinite || viewport.isNull || viewport.isEmpty, !rootFrame.isEmpty {
        viewport = rootFrame
      }
      var nodes: [SnapshotNode] = []
      appendPrivateAXNode(
        root,
        to: &nodes,
        options: options,
        viewport: viewport,
        depth: 0,
        parentIndex: nil,
        insideMatchedScope: false
      )
      if nodes.count <= 1 {
        NSLog("AGENT_DEVICE_RUNNER_PRIVATE_AX_SNAPSHOT_SPARSE=%ld", nodes.count)
        return nil
      }

      let depthLimited = effectiveDepth < requestedDepth
      NSLog(
        "AGENT_DEVICE_RUNNER_PRIVATE_AX_SNAPSHOT_USED nodes=%ld depth=%ld",
        nodes.count,
        effectiveDepth
      )
      return SnapshotBackendCapture(
        payload: DataPayload(nodes: nodes, truncated: (response["truncated"] as? Bool) == true),
        effectiveDepth: depthLimited ? effectiveDepth : nil
      )
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
    parentIndex: Int?,
    insideMatchedScope: Bool
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

    // Scope selects a subtree, matching regular snapshot semantics: once a node matches,
    // every descendant is inside scope and only the normal option filters apply to it.
    let scope = options.scope?.trimmingCharacters(in: .whitespacesAndNewlines)
    let scopeActive = (scope?.isEmpty == false)
    let matchesScope: Bool
    if scopeActive, let scope {
      let haystack = [label, identifier, value].joined(separator: "\n")
      matchesScope = haystack.localizedCaseInsensitiveContains(scope)
    } else {
      matchesScope = false
    }
    let nowInsideScope = insideMatchedScope || matchesScope

    let include: Bool
    if isRoot {
      include = true
    } else if scopeActive && !nowInsideScope {
      include = false
    } else if options.interactiveOnly && !visible {
      include = false
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
        parentIndex: currentIndex,
        insideMatchedScope: nowInsideScope
      )
    }
  }

  private func elementTypeName(rawElementType: Int) -> String {
    if let raw = UInt(exactly: rawElementType),
      let type = XCUIElement.ElementType(rawValue: raw)
    {
      return elementTypeName(type)
    }
    return "Element(\(rawElementType))"
  }

  private func privateAXLikelyInteractive(rawElementType: Int) -> Bool {
    guard let raw = UInt(exactly: rawElementType),
      let type = XCUIElement.ElementType(rawValue: raw)
    else {
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

// MARK: - In-bundle unit tests

extension RunnerTests {
  func testPrivateAXScopeSelectsSubtreeNotMatchingLabels() {
    let tree: [String: Any] = [
      "type": 1, "label": "App",
      "children": [
        [
          "type": 9, "identifier": "homeScreen",
          "children": [
            ["type": 48, "label": "Post body without the scope text", "children": []]
          ],
        ],
        ["type": 9, "label": "unrelated sibling", "children": []],
      ],
    ]
    var nodes: [SnapshotNode] = []
    appendPrivateAXNode(
      tree,
      to: &nodes,
      options: SnapshotOptions(
        interactiveOnly: false, compact: false, depth: nil, scope: "homeScreen", raw: false),
      viewport: .infinite,
      depth: 0,
      parentIndex: nil,
      insideMatchedScope: false
    )

    let labels = nodes.compactMap { $0.label ?? $0.identifier }
    XCTAssertTrue(labels.contains("homeScreen"))
    // Descendants of the matched scope are included even when they do not contain the text.
    XCTAssertTrue(labels.contains("Post body without the scope text"))
    XCTAssertFalse(labels.contains("unrelated sibling"))
  }
}
