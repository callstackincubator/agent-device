# Remote Tenancy

## When to open this file

Open this file for remote daemon HTTP flows that let an agent running in a Linux sandbox talk to another `agent-device` instance on a remote macOS host in order to control devices that are not available locally. This file covers daemon URL setup, authentication, `connect`, tenant lease scope, and remote Metro companion lifecycle.

## Main commands to reach for first

- `agent-device connect --remote-config <path>`
- `agent-device install-from-source <url> --remote-config <path> --platform android`
- `agent-device install-from-source --github-actions-artifact <org>/<repo>:<artifact> --remote-config <path> --platform android`
- `agent-device open <package> --remote-config <path> --relaunch`
- `agent-device metro reload --remote-config <path>`
- `agent-device snapshot --remote-config <path> -i`
- `agent-device disconnect --remote-config <path>`
- `agent-device connection status`
- `agent-device auth status`
- `AGENT_DEVICE_DAEMON_AUTH_TOKEN=...` for CI/service-token automation

## Most common mistake to avoid

Do not mix an arbitrary `--session` plus ad-hoc daemon, tenant, run, or lease flags. That can bypass saved Metro runtime hints. Use one of these patterns instead:

- Interactive flow: run `connect --remote-config <path>` once, then normal commands, then `disconnect`.
- Script flow: pass the same `--remote-config <path>` to every command, including `disconnect`.

## Choose one flow

### Interactive flow

Use this when the agent will run several commands in one session.

```bash
agent-device connect --remote-config ./remote-config.json

ARTIFACT_URL="<trusted-artifact-url>"
agent-device install-from-source "$ARTIFACT_URL" --platform android
agent-device open com.example.app --relaunch
agent-device metro reload
agent-device snapshot -i
agent-device fill @e3 "test@example.com"
agent-device disconnect
```

After `connect`, normal commands use the active remote connection. If cloud credentials are missing, `connect` starts login automatically in an interactive shell and stores a revocable CLI session that silently mints short-lived `adc_agent_...` command tokens. The cloud side remains responsible for token expiry, tenant/run claim checks, revocation, one-time device approval, and polling rate limits. End with `disconnect` to release the lease and stop the owned Metro companion.

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
- `metro reload` reuses saved Metro runtime hints and asks Metro to reload connected React Native apps without restarting the native process.
- `batch` also prepares Metro when any step opens an app and that step does not provide its own runtime.
- `disconnect` closes the session when possible, stops the Metro companion owned by the connection, releases the lease when one was allocated, and removes local connection state.

Remote install examples:

```bash
agent-device install com.example.app ./app.apk
ARTIFACT_URL="<trusted-artifact-url>"
agent-device install-from-source "$ARTIFACT_URL" --platform android
```

- Use `install` or `reinstall` for local paths; remote daemons upload local artifacts automatically.
- Use `install-from-source` only for trusted, operator-approved artifact URLs the remote daemon can reach. Do not fetch arbitrary user-supplied URLs.
- Use `install-from-source --github-actions-artifact <org>/<repo>:<artifact>` when the remote daemon has repository credentials and supports daemon-resolved GitHub Actions artifacts.
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
  "platform": "ios",
  "metroProxyBaseUrl": "https://bridge.example.com"
}
```

Optional overrides stay available for advanced cases:

```json
{
  "session": "adc-ios",
  "leaseBackend": "ios-instance",
  "metroProjectRoot": ".",
  "metroKind": "expo",
  "metroPublicBaseUrl": "http://127.0.0.1:8081"
}
```

- Keep service tokens in env/config managed by the operator boundary. Do not persist auth tokens in connection state. Human login uses `agent-device auth login` or implicit `connect` login and stores only the CLI session credential.
- Omit Metro fields for non-React Native flows.
- Put `tenant`, `runId`, and `sessionIsolation` in the remote profile so agents can run `agent-device connect --remote-config ./remote-config.json` without extra scope flags. Add `platform`, `leaseBackend`, `session`, or Metro overrides only when the default inference is not enough for that flow.
- Explicit command-line flags override connected defaults. Use them intentionally when switching session, platform, target, tenant, run, or lease scope.
- For React Native Metro runs with `metroProxyBaseUrl`, `agent-device >= 0.11.12` can manage the local companion tunnel, but Metro itself still needs to be running locally. `metroProxyBaseUrl` is the bridge origin, not a prebuilt `/api/metro/...` route.
- For cloud stock React Native iOS, use the bridge descriptor's wildcard HTTPS Metro hints directly; do not install or launch the XCTest runner just to make Metro reachable.
- Android keeps using bridge-provided `/api/metro/runtimes/<runtimeId>/...` Metro routes.
- `metroPublicBaseUrl` is only needed for direct/non-bridge bundle hints. Bridged profiles can omit it.
- Use a lease backend that matches the bridge target platform, for example `android-instance`, `ios-instance`, or an explicit `--lease-backend` override.

## Transport prerequisites

- Start the daemon in HTTP mode with `AGENT_DEVICE_DAEMON_SERVER_MODE=http|dual` on the host.
- Point the profile or env at the remote host with `daemonBaseUrl` or `AGENT_DEVICE_DAEMON_BASE_URL=http(s)://host:port[/base-path]`.
- For humans, run `connect --remote-config <path>` and let it refresh or create the CLI session. Use `agent-device auth status` to inspect it and `agent-device auth logout` to remove it.
- For CI/non-interactive shells, set `AGENT_DEVICE_DAEMON_AUTH_TOKEN=adc_live_...` or pass `--daemon-auth-token`. The client does not start device-code polling in CI by default.
- Prefer an auth hook such as `AGENT_DEVICE_HTTP_AUTH_HOOK` when the host needs caller validation or tenant injection.

## Lease debug fallback

The main agent flow should use `connect` and `connection status`. For daemon-side auth, scope, or lease debugging, inspect host-side daemon logs and operator tooling instead of issuing raw daemon RPC from the agent shell.

## GitHub Actions artifact install

Use this when a compatible remote daemon resolves GitHub Actions artifacts server-side. Do not download CI artifacts locally or add a local `GITHUB_TOKEN` just to install CI output.

Artifact ID shape:

```bash
agent-device install-from-source \
  --github-actions-artifact OWNER/REPO:1234567890 \
  --remote-config ./remote-config.json \
  --platform android
```

Artifact-name shape:

```bash
agent-device install-from-source \
  --github-actions-artifact OWNER/REPO:app-debug \
  --remote-config ./remote-config.json \
  --platform ios
```

Config shape:

```json
{
  "installSource": {
    "type": "github-actions-artifact",
    "repo": "OWNER/REPO",
    "artifact": "app-debug"
  }
}
```

Numeric artifacts are passed as artifact IDs. Non-numeric artifacts are passed as artifact names.

## Failure semantics and trust notes

- Missing tenant, run, or lease fields in tenant-isolation mode should fail as `INVALID_ARGS`.
- Inactive or scope-mismatched leases should fail as `UNAUTHORIZED`.
- Inspect logs on the remote host during remote debugging. Client-side `--debug` does not tail a local daemon log once `AGENT_DEVICE_DAEMON_BASE_URL` is set.
- Do not point `AGENT_DEVICE_DAEMON_BASE_URL` at untrusted hosts. Remote daemon requests can launch apps and execute interaction commands.
- Treat daemon auth tokens and lease identifiers as sensitive operational data.
