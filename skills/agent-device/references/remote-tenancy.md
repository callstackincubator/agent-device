# Remote Tenancy and Lease Admission

Use this reference for remote daemon HTTP flows that require explicit
tenant/run admission control.

## Transport prerequisites

- Start daemon in HTTP mode (`AGENT_DEVICE_DAEMON_SERVER_MODE=http|dual`).
- Point remote clients at the host with `AGENT_DEVICE_DAEMON_BASE_URL=http(s)://host:port[/base-path]`
  or `--daemon-base-url <url>` so the CLI skips local daemon discovery/startup.
- Use `AGENT_DEVICE_DAEMON_AUTH_TOKEN` / `--daemon-auth-token` when the client should send the
  shared daemon token automatically.
- Direct JSON-RPC callers can use a token in params, `Authorization: Bearer <token>`, or
  `x-agent-device-token`.
- Prefer an auth hook (`AGENT_DEVICE_HTTP_AUTH_HOOK`) for caller validation and
  tenant injection.

## Lease lifecycle (JSON-RPC)

Use `POST /rpc` with JSON-RPC 2.0 methods:

- `agent_device.lease.allocate`
- `agent_device.lease.heartbeat`
- `agent_device.lease.release`

Example allocate:

```bash
curl -sS "${AGENT_DEVICE_DAEMON_BASE_URL}/rpc" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":"alloc-1","method":"agent_device.lease.allocate","params":{"tenantId":"acme","runId":"run-123","ttlMs":60000}}'
```

Example heartbeat:

```bash
curl -sS "${AGENT_DEVICE_DAEMON_BASE_URL}/rpc" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":"hb-1","method":"agent_device.lease.heartbeat","params":{"leaseId":"<lease-id>","ttlMs":60000}}'
```

Example release:

```bash
curl -sS "${AGENT_DEVICE_DAEMON_BASE_URL}/rpc" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":"rel-1","method":"agent_device.lease.release","params":{"leaseId":"<lease-id>"}}'
```

Example session-locked command request:

```bash
curl -sS "${AGENT_DEVICE_DAEMON_BASE_URL}/rpc" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":"cmd-1","method":"agent_device.command","params":{"session":"qa-ios","command":"snapshot","positionals":[],"meta":{"lockPolicy":"reject","lockPlatform":"ios","tenantId":"acme","runId":"run-123","leaseId":"<lease-id>"}}}'
```

Direct RPC callers can send the same session lock concept as the CLI and typed client through `meta.lockPolicy` and optional `meta.lockPlatform`.

## Command admission contract

For tenant-isolated command execution, pass all four flags:

```bash
agent-device \
  --tenant acme \
  --session-isolation tenant \
  --run-id run-123 \
  --lease-id <lease-id> \
  session list --json
```

Admission checks require tenant/run/lease scope alignment.

The CLI sends `AGENT_DEVICE_DAEMON_AUTH_TOKEN` in both the JSON-RPC request token field and HTTP
auth headers so existing daemon auth paths continue to work.

## Failure semantics

- Missing tenant/run/lease fields in tenant isolation mode: `INVALID_ARGS`
- Lease not active or wrong scope: `UNAUTHORIZED`
- Method mismatch: JSON-RPC `-32601` (HTTP 404)

## Operational guidance

- Keep TTL short and heartbeat only while a run is active.
- Release lease immediately on run completion/error paths.
- For remote debug sessions, inspect logs on the remote host; client-side `--debug` no longer tails
  a local daemon log when `AGENT_DEVICE_DAEMON_BASE_URL` is set.
- For bounded hosts, configure:
  - `AGENT_DEVICE_MAX_SIMULATOR_LEASES`
  - `AGENT_DEVICE_LEASE_TTL_MS`
  - `AGENT_DEVICE_LEASE_MIN_TTL_MS`
  - `AGENT_DEVICE_LEASE_MAX_TTL_MS`
