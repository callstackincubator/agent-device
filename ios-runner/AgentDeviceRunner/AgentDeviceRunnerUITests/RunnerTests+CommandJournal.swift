import Foundation
import XCTest

enum RunnerCommandLifecycleState: String {
  case notAccepted
  case accepted
  case started
  case completed
  case failed
}

struct RunnerCommandJournalEntry {
  let commandId: String
  let command: String
  var state: RunnerCommandLifecycleState
  var responseOk: Bool?
  var responseJson: String?
  var error: ErrorPayload?
}

final class RunnerCommandJournal {
  private let lock = NSLock()
  private let maxEntries = 64
  private let maxResponseJsonBytes = 16 * 1024
  private var entries: [String: RunnerCommandJournalEntry] = [:]
  private var order: [String] = []

  func accept(command: Command) {
    guard let commandId = normalizedCommandId(command.commandId) else { return }
    lock.lock()
    defer { lock.unlock() }
    entries[commandId] = RunnerCommandJournalEntry(
      commandId: commandId,
      command: command.command.rawValue,
      state: .accepted,
      responseOk: nil,
      responseJson: nil,
      error: nil
    )
    order.removeAll { $0 == commandId }
    order.append(commandId)
    pruneIfNeeded()
  }

  func start(command: Command) {
    update(command: command, state: .started, responseOk: nil, responseJson: nil, error: nil)
  }

  func finish(command: Command, response: Response) {
    update(
      command: command,
      state: response.ok ? .completed : .failed,
      responseOk: response.ok,
      responseJson: encodeResponseJson(command: command, response: response),
      error: response.error
    )
  }

  func fail(command: Command, error: Error) {
    update(
      command: command,
      state: .failed,
      responseOk: nil,
      responseJson: nil,
      error: ErrorPayload(message: error.localizedDescription)
    )
  }

  func status(commandId: String) -> DataPayload {
    guard let normalized = normalizedCommandId(commandId) else {
      return DataPayload(lifecycleState: RunnerCommandLifecycleState.notAccepted.rawValue)
    }
    lock.lock()
    let entry = entries[normalized]
    lock.unlock()
    guard let entry else {
      return DataPayload(
        commandId: normalized,
        lifecycleState: RunnerCommandLifecycleState.notAccepted.rawValue
      )
    }
    return DataPayload(
      commandId: entry.commandId,
      lifecycleState: entry.state.rawValue,
      lifecycleCommand: entry.command,
      lifecycleResponseOk: entry.responseOk,
      lifecycleResponseJson: entry.responseJson,
      lifecycleErrorCode: entry.error?.code,
      lifecycleErrorMessage: entry.error?.message,
      lifecycleErrorHint: entry.error?.hint
    )
  }

  private func update(
    command: Command,
    state: RunnerCommandLifecycleState,
    responseOk: Bool?,
    responseJson: String?,
    error: ErrorPayload?
  ) {
    guard let commandId = normalizedCommandId(command.commandId) else { return }
    lock.lock()
    defer { lock.unlock() }
    var entry = entries[commandId] ?? RunnerCommandJournalEntry(
      commandId: commandId,
      command: command.command.rawValue,
      state: .accepted,
      responseOk: nil,
      responseJson: nil,
      error: nil
    )
    entry.state = state
    entry.responseOk = responseOk
    entry.responseJson = responseJson
    entry.error = error
    entries[commandId] = entry
    order.removeAll { $0 == commandId }
    order.append(commandId)
    pruneIfNeeded()
  }

  private func pruneIfNeeded() {
    while order.count > maxEntries {
      let removed = order.removeFirst()
      entries.removeValue(forKey: removed)
    }
  }

  private func normalizedCommandId(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func encodeResponseJson(command: Command, response: Response) -> String? {
    guard shouldRetainResponseJson(command: command) else { return nil }
    guard let data = try? JSONEncoder().encode(response) else { return nil }
    guard data.count <= maxResponseJsonBytes else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private func shouldRetainResponseJson(command: Command) -> Bool {
    switch command.command {
    case .snapshot, .screenshot:
      return false
    case .tap, .mouseClick, .tapSeries, .longPress, .interactionFrame, .drag, .dragSeries,
         .remotePress, .type, .swipe, .findText, .querySelector, .readText, .back, .backInApp,
         .backSystem, .home, .rotate, .appSwitcher, .keyboardDismiss, .keyboardReturn, .alert,
         .pinch, .rotateGesture, .transformGesture, .recordStart, .recordStop, .status, .uptime,
         .shutdown:
      return true
    }
  }
}

extension RunnerTests {
  func testCommandJournalRetentionPolicy() throws {
    let journal = RunnerCommandJournal()

    let uptime = runnerJournalCommand("uptime", id: "small-scalar")
    journal.accept(command: uptime)
    journal.finish(
      command: uptime,
      response: Response(ok: true, data: DataPayload(currentUptimeMs: 12.5))
    )

    let scalarStatus = journal.status(commandId: "small-scalar")
    XCTAssertEqual(scalarStatus.lifecycleState, RunnerCommandLifecycleState.completed.rawValue)
    XCTAssertEqual(scalarStatus.lifecycleResponseOk, true)
    XCTAssertNotNil(scalarStatus.lifecycleResponseJson)
    let scalarResponse = try decodeRunnerJournalResponse(scalarStatus.lifecycleResponseJson)
    XCTAssertEqual(scalarResponse.data?.currentUptimeMs, 12.5)

    let querySelector = runnerJournalCommand("querySelector", id: "small-object")
    journal.accept(command: querySelector)
    journal.finish(
      command: querySelector,
      response: Response(ok: true, data: DataPayload(found: true, nodes: [runnerJournalNode()]))
    )

    let objectStatus = journal.status(commandId: "small-object")
    XCTAssertNotNil(objectStatus.lifecycleResponseJson)
    let objectResponse = try decodeRunnerJournalResponse(objectStatus.lifecycleResponseJson)
    XCTAssertEqual(objectResponse.data?.found, true)
    XCTAssertEqual(objectResponse.data?.nodes?.count, 1)

    let snapshot = runnerJournalCommand("snapshot", id: "snapshot-tree")
    journal.accept(command: snapshot)
    journal.finish(
      command: snapshot,
      response: Response(ok: true, data: DataPayload(nodes: [runnerJournalNode()], truncated: false))
    )

    let snapshotStatus = journal.status(commandId: "snapshot-tree")
    XCTAssertEqual(snapshotStatus.lifecycleState, RunnerCommandLifecycleState.completed.rawValue)
    XCTAssertEqual(snapshotStatus.lifecycleResponseOk, true)
    XCTAssertNil(snapshotStatus.lifecycleResponseJson)

    let screenshot = runnerJournalCommand("screenshot", id: "screenshot-artifact")
    journal.accept(command: screenshot)
    journal.finish(
      command: screenshot,
      response: Response(ok: true, data: DataPayload(message: "tmp/screenshot-1.png"))
    )

    let screenshotStatus = journal.status(commandId: "screenshot-artifact")
    XCTAssertEqual(screenshotStatus.lifecycleState, RunnerCommandLifecycleState.completed.rawValue)
    XCTAssertEqual(screenshotStatus.lifecycleResponseOk, true)
    XCTAssertNil(screenshotStatus.lifecycleResponseJson)

    let largeRead = runnerJournalCommand("readText", id: "large-read")
    journal.accept(command: largeRead)
    journal.finish(
      command: largeRead,
      response: Response(ok: true, data: DataPayload(text: String(repeating: "x", count: 17 * 1024)))
    )

    let largeReadStatus = journal.status(commandId: "large-read")
    XCTAssertEqual(largeReadStatus.lifecycleState, RunnerCommandLifecycleState.completed.rawValue)
    XCTAssertEqual(largeReadStatus.lifecycleResponseOk, true)
    XCTAssertNil(largeReadStatus.lifecycleResponseJson)
  }

  func testCommandJournalKeepsErrorMetadataWhenResponseJsonIsDropped() {
    let journal = RunnerCommandJournal()
    let snapshot = runnerJournalCommand("snapshot", id: "snapshot-error")
    let hint = "Try a smaller read such as snapshot -s <visible label or id> -d 8."

    journal.accept(command: snapshot)
    journal.finish(
      command: snapshot,
      response: Response(
        ok: false,
        error: ErrorPayload(
          code: "IOS_AX_SNAPSHOT_FAILED",
          message: "iOS XCTest snapshot failed while serializing the accessibility tree.",
          hint: hint
        )
      )
    )

    let status = journal.status(commandId: "snapshot-error")
    XCTAssertEqual(status.lifecycleState, RunnerCommandLifecycleState.failed.rawValue)
    XCTAssertEqual(status.lifecycleResponseOk, false)
    XCTAssertNil(status.lifecycleResponseJson)
    XCTAssertEqual(status.lifecycleErrorCode, "IOS_AX_SNAPSHOT_FAILED")
    XCTAssertEqual(
      status.lifecycleErrorMessage,
      "iOS XCTest snapshot failed while serializing the accessibility tree."
    )
    XCTAssertEqual(status.lifecycleErrorHint, hint)
  }

  private func runnerJournalCommand(_ command: String, id: String) -> Command {
    let json = #"{"command":"\#(command)","commandId":"\#(id)"}"#
    return try! JSONDecoder().decode(Command.self, from: Data(json.utf8))
  }

  private func runnerJournalNode() -> SnapshotNode {
    SnapshotNode(
      index: 0,
      type: "button",
      label: "Continue",
      identifier: "continue",
      value: nil,
      rect: SnapshotRect(x: 10, y: 20, width: 100, height: 44),
      enabled: true,
      focused: nil,
      selected: nil,
      hittable: true,
      depth: 0,
      parentIndex: nil,
      hiddenContentAbove: nil,
      hiddenContentBelow: nil
    )
  }

  private func decodeRunnerJournalResponse(_ responseJson: String?) throws -> Response {
    let responseJson = try XCTUnwrap(responseJson)
    return try JSONDecoder().decode(Response.self, from: Data(responseJson.utf8))
  }
}
