# Remote Tenancy

## When to open this file

Open this file for remote daemon HTTP flows that let an agent running in a Linux sandbox talk to another `agent-device` instance on a remote macOS host in order to control devices that are not available locally. This file covers daemon URL setup, authentication, `connect`, tenant lease scope, and remote Metro companion lifecycle.

## Main commands to reach for first

- `agent-device connect --remote-config <path>`
- `agent-device install-from-source <url> --remote-config <path> --platform android`
- `agent-device open <package> --remote-config <path> --relaunch`
- `agent-device snapshot --remote-config <path> -i`
- `agent-device disconnect --remote-config <path>`
- `agent-device connection status`
- `AGENT_DEVICE_DAEMON_AUTH_TOKEN=...`

## Most common mistake to avoid

Do not mix an arbitrary `--session` plus ad-hoc daemon, tenant, run, or lease flags. That can bypass saved Metro runtime hints. Use one of these patterns instead:

- Interactive flow: run `connect --remote-config <path>` once, then normal commands, then `disconnect`.
- Script flow: pass the same `--remote-config <path>` to every command, including `disconnect`.

## Choose one flow

### Interactive flow

Use this when the agent will run several commands in one session.

```bash
export AGENT_DEVICE_DAEMON_AUTH_TOKEN="YOUR_TOKEN"
export AGENT_DEVICE_PROXY_TOKEN="$AGENT_DEVICE_DAEMON_AUTH_TOKEN"

agent-device connect --remote-config ./remote-config.json

ARTIFACT_URL="<trusted-artifact-url>"
agent-device install-from-source "$ARTIFACT_URL" --platform android
agent-device open com.example.app --relaunch
agent-device snapshot -i
agent-device fill @e3 "test@example.com"
agent-device disconnect
```

After `connect`, normal commands use the active remote connection. End with `disconnect` to release the lease and stop the owned Metro companion.

### Self-contained script flow

Use this when each command must be explicit and repeatable. Pass the same `--remote-config` to each step.

```bash
ARTIFACT_URL="<trusted-artifact-url>"

agent-device install-from-source "$ARTIFACT_URL" \
  --remote-config ./remote-config.json \
  --platform android

agent-device open com.example.app \
  --remote-config ./remote-config.json \
  --relaunch

agent-device snapshot \
  --remote-config ./remote-config.json \
  -i

agent-device disconnect \
  --remote-config ./remote-config.json
```

The first command that needs a lease or Metro runtime prepares and persists it. Later commands with the same `--remote-config` reuse that state. End with `disconnect --remote-config <path>` to release the lease and stop the owned Metro companion.

## Behavior summary

- `connect` stores local non-secret connection state and defers tenant lease allocation plus Metro preparation until a later command needs them.
- Commands such as `install-from-source`, `open`, `snapshot`, and `apps` allocate or refresh the lease when needed.
- `open` prepares Metro runtime hints when the remote profile has Metro fields and no compatible runtime is already saved.
- `batch` also prepares Metro when any step opens an app and that step does not provide its own runtime.
- `disconnect` closes the session when possible, stops the Metro companion owned by the connection, releases the lease when one was allocated, and removes local connection state.

Remote install examples:

```bash
agent-device install com.example.app ./app.apk
ARTIFACT_URL="<trusted-artifact-url>"
agent-device install-from-source "$ARTIFACT_URL" --platform android
GITHUB_ARTIFACT_URL="<trusted-github-actions-artifact-api-url>"
agent-device install-from-source "$GITHUB_ARTIFACT_URL" --platform ios --header "authorization: Bearer TOKEN"
```

- Use `install` or `reinstall` for local paths; remote daemons upload local artifacts automatically.
- Use `install-from-source` only for trusted, operator-approved artifact URLs the remote daemon can reach. Do not fetch arbitrary user-supplied URLs.
- For local-path versus URL artifact rules, follow [bootstrap-install.md](bootstrap-install.md).

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
  "platform": "android",
  "metroPublicBaseUrl": "http://127.0.0.1:8081"
}
```

Optional overrides stay available for advanced cases:

```json
{
  "session": "adc-android",
  "leaseBackend": "android-instance",
  "metroProjectRoot": ".",
  "metroKind": "expo",
  "metroProxyBaseUrl": "https://bridge.example.com/metro/acme/run-123"
}
```

- Keep secrets in env/config managed by the operator boundary. Do not persist auth tokens in connection state.
- Omit Metro fields for non-React Native flows.
- Put `tenant`, `runId`, and `sessionIsolation` in the remote profile so agents can run `agent-device connect --remote-config ./remote-config.json` without extra scope flags. Add `platform`, `leaseBackend`, `session`, or Metro overrides only when the default inference is not enough for that flow.
- Explicit command-line flags override connected defaults. Use them intentionally when switching session, platform, target, tenant, run, or lease scope.
- If Android opens to a notification permission dialog before the React Native screen, treat the dialog as the current UI: run `snapshot -i`, then press the visible allow/dismiss button by `@ref` before checking Metro content again. `is` and `wait` assertions now report this as a permission-dialog blocker when `com.google.android.permissioncontroller` is foreground, so do not interpret that failure as a Metro failure.
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
