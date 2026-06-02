import XCTest

extension RunnerTests {
  // MARK: - Blocking System Modal Snapshot

  func blockingSystemAlertSnapshot() -> DataPayload? {
    #if os(macOS)
      return nil
    #else
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
    #endif
  }

  func firstBlockingSystemModal(in springboard: XCUIApplication) -> XCUIElement? {
    let disableSafeProbe = RunnerEnv.isTruthy("AGENT_DEVICE_RUNNER_DISABLE_SAFE_MODAL_PROBE")
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

  func safeElementsQuery(_ fetch: () -> [XCUIElement]) -> [XCUIElement] {
    safely("MODAL_QUERY", [], fetch)
  }

  private func safeIsBlockingSystemModal(_ element: XCUIElement, in springboard: XCUIApplication) -> Bool {
    safely("MODAL_CHECK", false) { isBlockingSystemModal(element, in: springboard) }
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

  func actionableElements(in element: XCUIElement) -> [XCUIElement] {
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
    safely("MODAL_ACTION", false) {
      if !candidate.exists || !candidate.isHittable { return false }
      if !actionableTypes.contains(candidate.elementType) { return false }
      let frame = candidate.frame
      if frame.isNull || frame.isEmpty { return false }
      let key = "\(candidate.elementType.rawValue)-\(frame.origin.x)-\(frame.origin.y)-\(frame.size.width)-\(frame.size.height)-\(candidate.label)"
      if seen.contains(key) { return false }
      seen.insert(key)
      return true
    }
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
      focused: elementHasFocus(element) ? true : nil,
      selected: element.isSelected ? true : nil,
      hittable: hittableOverride ?? element.isHittable,
      depth: depth,
      parentIndex: nil,
      hiddenContentAbove: nil,
      hiddenContentBelow: nil
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
    safely("MODAL_NODE") {
      makeSnapshotNode(
        element: element,
        index: index,
        type: type,
        labelOverride: labelOverride,
        identifierOverride: identifierOverride,
        depth: depth,
        hittableOverride: hittableOverride
      )
    }
  }
}
