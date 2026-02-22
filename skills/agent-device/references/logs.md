# Logs (Token-Efficient Debugging)

App output is written to a session-scoped file so agents can grep it instead of loading full logs into context.

## Quick Flow

```bash
agent-device open MyApp --platform ios
agent-device logs start              # Start streaming app logs to session file
agent-device logs path               # Print path, e.g. ~/.agent-device/sessions/default/app.log
agent-device logs doctor             # Check tool/runtime readiness for current session/device
agent-device logs mark "before tap"  # Insert a timeline marker into app.log
# ... run flows; on failure, grep the path (see below)
agent-device logs stop               # Stop streaming (optional; close also stops)
```

## Command Notes

- `logs path`: returns log file path and metadata (`active`, `state`, `backend`, size, timestamps).
- `logs start`: starts streaming; requires an active app session (`open` first). Supported on iOS simulator, iOS device, and Android.
- `logs stop`: stops streaming. Session `close` also stops logging.
- `logs doctor`: reports backend/tool checks and readiness notes for troubleshooting.
- `logs mark`: writes a timestamped marker line to the session log.

## Behavior and Limits

- `logs start` appends to `app.log` and rotates to `app.log.1` when `app.log` exceeds 5 MB.
- Android log streaming automatically rebinds to the app PID after process restarts.
- iOS log capture relies on Unified Logging signals (for example `os_log`); plain stdout/stderr output may be limited depending on app/runtime.
- Retention knobs:
  - `AGENT_DEVICE_APP_LOG_MAX_BYTES`
  - `AGENT_DEVICE_APP_LOG_MAX_FILES`
- Optional write-time redaction patterns:
  - `AGENT_DEVICE_APP_LOG_REDACT_PATTERNS` (comma-separated regex)

## Grep Patterns

After getting the path from `logs path`, run `grep` (or `grep -E`) so only matching lines enter context.

```bash
# Get path first, then grep it; -n adds line numbers
grep -n "Error\|Exception\|Fatal" <path>
grep -n -E "Error|Exception|Fatal|crash" <path>

# Bounded context: last N lines only
tail -50 <path>
```

- Use `-n` for line numbers.
- Use `-E` for extended regex so `|` in the pattern does not need escaping.
- Prefer targeted patterns (e.g. `Error`, `Exception`, or app-specific tags) over reading the full file.
