# Remote Tenancy

## When to open this file

Open this file for remote daemon HTTP flows that let an agent running in a Linux sandbox talk to another `agent-device` instance on a remote macOS host in order to control devices that are not available locally. This file covers daemon URL setup, authentication, `connect`, tenant lease scope, and remote Metro companion lifecycle.

## Main commands to reach for first

- `agent-device connect --remote-config <path>`
- `agent-device connection status`
- `agent-device disconnect`
- `AGENT_DEVICE_DAEMON_AUTH_TOKEN=...`

## Most common mistake to avoid

Do not run remote tenant work by repeating `--remote-config` on every command. `--remote-config` is a `connect` input. After connecting, use normal `agent-device` commands; the active connection supplies daemon URL, tenant, run, lease, and prepared Metro runtime context.

## Preferred remote flow

Use this when the agent needs the simplest remote control flow: a Linux sandbox agent talks over HTTP to `agent-device` on a remote macOS host and launches the target app through a checked-in `--remote-config` profile.

```bash
export AGENT_DEVICE_DAEMON_AUTH_TOKEN="YOUR_TOKEN"
export AGENT_DEVICE_PROXY_TOKEN="$AGENT_DEVICE_DAEMON_AUTH_TOKEN"

agent-device connect \
  --remote-config ./remote-config.json

agent-device install com.example.app ./app.apk
agent-device open com.example.app --relaunch
agent-device snapshot -i
agent-device fill @e3 "test@example.com"
agent-device disconnect
```

`connect` resolves the remote profile, verifies daemon reachability through the normal client path, allocates or refreshes the tenant lease, prepares local Metro when the profile has Metro fields, starts the local Metro companion when the bridge needs it, and writes local non-secret connection state for later commands. `disconnect` closes the session when possible, stops the Metro companion owned by that connection, releases the lease, and removes local connection state.

Use `agent-device connection status --session adc-android` to inspect the active connection without reading JSON state manually. Status output must not include auth tokens.

## Remote config shape

Example `remote-config.json` shape:

```json
{
  "daemonBaseUrl": "https://bridge.example.com/agent-device",
  "daemonTransport": "http",
  "tenant": "acme",
  "runId": "run-123",
  "sessionIsolation": "tenant",
  "session": "adc-android",
  "platform": "android",
  "leaseBackend": "android-instance",
  "metroProjectRoot": ".",
  "metroPublicBaseUrl": "http://127.0.0.1:8081",
  "metroProxyBaseUrl": "https://bridge.example.com/metro/acme/run-123"
}
```

- Keep secrets in env/config managed by the operator boundary. Do not persist auth tokens in connection state.
- Omit Metro fields for non-React Native flows.
- Put `tenant`, `runId`, `session`, `sessionIsolation`, `platform`, and `leaseBackend` in the remote profile when possible so agents can run `agent-device connect --remote-config ./remote-config.json` without extra scope flags.
- Explicit command-line flags override connected defaults. Use them intentionally when switching session, platform, target, tenant, run, or lease scope.
- For React Native Metro runs with `metroProxyBaseUrl`, `agent-device >= 0.11.12` can manage the local companion tunnel, but Metro itself still needs to be running locally.
- Use a lease backend that matches the bridge target platform, for example `android-instance`, `ios-instance`, or an explicit `--lease-backend` override.

## Transport prerequisites

- Start the daemon in HTTP mode with `AGENT_DEVICE_DAEMON_SERVER_MODE=http|dual` on the host.
- Point the profile or env at the remote host with `daemonBaseUrl` or `AGENT_DEVICE_DAEMON_BASE_URL=http(s)://host:port[/base-path]`.
- For non-loopback remote hosts, set `AGENT_DEVICE_DAEMON_AUTH_TOKEN` or `--daemon-auth-token`. The client rejects non-loopback remote daemon URLs without auth.
- Direct JSON-RPC callers can authenticate with request params, `Authorization: Bearer <token>`, or `x-agent-device-token`.
- Prefer an auth hook such as `AGENT_DEVICE_HTTP_AUTH_HOOK` when the host needs caller validation or tenant injection.

## Manual lease debug fallback

The main agent flow should use `connect`. Use manual JSON-RPC only for host-side automation or daemon-side auth/scope debugging, and only against trusted daemon hosts.

```bash
curl -fsS "$AGENT_DEVICE_DAEMON_BASE_URL/rpc" \
  -H "Authorization: Bearer $AGENT_DEVICE_DAEMON_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "lease-1",
    "method": "agent_device.lease.allocate",
    "params": {
      "tenantId": "acme",
      "runId": "run-123",
      "backend": "android-instance"
    }
  }'
```

Related daemon methods are `agent_device.lease.allocate`, `agent_device.lease.heartbeat`, `agent_device.lease.release`, and `agent_device.command`.

## Failure semantics and trust notes

- Missing tenant, run, or lease fields in tenant-isolation mode should fail as `INVALID_ARGS`.
- Inactive or scope-mismatched leases should fail as `UNAUTHORIZED`.
- Inspect logs on the remote host during remote debugging. Client-side `--debug` does not tail a local daemon log once `AGENT_DEVICE_DAEMON_BASE_URL` is set.
- Do not point `AGENT_DEVICE_DAEMON_BASE_URL` at untrusted hosts. Remote daemon requests can launch apps and execute interaction commands.
- Treat daemon auth tokens and lease identifiers as sensitive operational data.
