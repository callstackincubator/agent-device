import Foundation

enum RunnerCommandLifecycleState: String {
  case accepted
  case started
  case completed
  case failed
}

struct RunnerCommandJournalEntry {
  let commandId: String
  let command: String
  var state: RunnerCommandLifecycleState
  var response: Response?
  var error: ErrorPayload?
  var updatedAtMs: Double
}

final class RunnerCommandJournal {
  private let lock = NSLock()
  private let maxEntries = 64
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
      response: nil,
      error: nil,
      updatedAtMs: currentTimeMs()
    )
    order.removeAll { $0 == commandId }
    order.append(commandId)
    pruneIfNeeded()
  }

  func start(command: Command) {
    update(command: command, state: .started, response: nil, error: nil)
  }

  func finish(command: Command, response: Response) {
    update(
      command: command,
      state: response.ok ? .completed : .failed,
      response: response,
      error: response.error
    )
  }

  func fail(command: Command, error: Error) {
    update(
      command: command,
      state: .failed,
      response: nil,
      error: ErrorPayload(message: error.localizedDescription)
    )
  }

  func status(commandId: String) -> DataPayload {
    guard let normalized = normalizedCommandId(commandId) else {
      return DataPayload(lifecycleState: "notAccepted")
    }
    lock.lock()
    let entry = entries[normalized]
    lock.unlock()
    guard let entry else {
      return DataPayload(commandId: normalized, lifecycleState: "notAccepted")
    }
    return DataPayload(
      commandId: entry.commandId,
      lifecycleState: entry.state.rawValue,
      lifecycleCommand: entry.command,
      lifecycleResponseOk: entry.response?.ok,
      lifecycleResponseJson: encodeResponseJson(entry.response),
      lifecycleErrorCode: entry.error?.code,
      lifecycleErrorMessage: entry.error?.message,
      lifecycleErrorHint: entry.error?.hint
    )
  }

  private func update(
    command: Command,
    state: RunnerCommandLifecycleState,
    response: Response?,
    error: ErrorPayload?
  ) {
    guard let commandId = normalizedCommandId(command.commandId) else { return }
    lock.lock()
    defer { lock.unlock() }
    var entry = entries[commandId] ?? RunnerCommandJournalEntry(
      commandId: commandId,
      command: command.command.rawValue,
      state: .accepted,
      response: nil,
      error: nil,
      updatedAtMs: currentTimeMs()
    )
    entry.state = state
    entry.response = response
    entry.error = error
    entry.updatedAtMs = currentTimeMs()
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

  private func currentTimeMs() -> Double {
    Date().timeIntervalSince1970 * 1000
  }

  private func encodeResponseJson(_ response: Response?) -> String? {
    guard let response else { return nil }
    guard let data = try? JSONEncoder().encode(response) else { return nil }
    return String(data: data, encoding: .utf8)
  }
}
