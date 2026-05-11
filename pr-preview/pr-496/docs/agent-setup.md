# AI Agent Setup

`agent-device` is built for AI agents, but humans usually install it, grant device permissions, and decide which agent client should use it. Use this page when setting up Cursor, Codex, Claude Code, Windsurf, Cline, Goose, or another coding agent for AI mobile testing, React Native QA, Expo app verification, iOS Simulator automation, Android Emulator automation, tvOS checks, Android TV checks, or desktop app verification.

The short version: install the CLI, make the agent read version-matched help, and let the agent run CLI commands in a terminal. MCP is available for discovery and help, not broad device control.

## Install

```bash
npm install -g agent-device@latest
agent-device --version
agent-device help workflow
```

For one-off use without a global install:

```bash
npx -y agent-device@latest --version
npx -y agent-device@latest help workflow
```

Global install is better for normal agent workflows because repeated commands, skills, and terminal sessions resolve to one stable version.

## Recommended agent rule

Add this as a project rule, custom instruction, or skill equivalent when your agent client supports it:

```text
Use agent-device only for app/device automation tasks. Before planning commands, run `agent-device --version` and read `agent-device help workflow`. For exploratory QA, read `agent-device help dogfood`. For logs, network, traces, or runtime failures, read `agent-device help debugging`. For React Native component trees, props/state/hooks, slow renders, or rerenders, read `agent-device help react-devtools`.

Use the CLI in the integrated terminal. MCP is only a discovery/help router and does not expose device automation tools. Prefer `open -> snapshot -i -> act -> re-snapshot -> verify -> close`. Use current refs such as `@e3` for exploration and selectors for durable replay. Keep mutating commands against one session serial. Capture screenshots, logs, network, perf, traces, recordings, and `.ad` replay scripts only when they add evidence.
```

The bundled [agent-device skill](https://github.com/callstackincubator/agent-device/blob/main/skills/agent-device/SKILL.md) is the canonical router for skill-aware clients. It intentionally points agents back to installed CLI help instead of duplicating the command manual.

## Cursor

Use Agent mode with the integrated terminal. Add the recommended rule above as a project rule, then run:

```bash
agent-device help workflow
agent-device apps --platform ios
agent-device open <app-or-url> --platform ios
agent-device snapshot -i
```

Optional Cursor MCP configuration in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agent-device": {
      "command": "agent-device",
      "args": ["mcp"]
    }
  }
}
```

No global install variant:

```json
{
  "mcpServers": {
    "agent-device": {
      "command": "npx",
      "args": ["-y", "agent-device@latest", "mcp"]
    }
  }
}
```

## Codex

Put the recommended rule in `AGENTS.md` or the project instructions. Let Codex run `agent-device` in the terminal:

```bash
agent-device help workflow
agent-device boot --platform ios
agent-device open <app-or-url> --platform ios
agent-device snapshot -i
```

For reviews or planning-only tasks, tell the agent not to run devices unless explicitly requested.

## Claude Code

Use the bundled skill when your Claude setup supports skills. Otherwise put the recommended rule in `CLAUDE.md`.

```bash
agent-device --version
agent-device help workflow
agent-device help dogfood
```

If you configure MCP, keep using CLI commands for automation. The MCP router gives Claude install/status/help context only.

## Windsurf, Cline, Goose, and other MCP clients

Use the generic MCP config when the client supports `mcpServers`, then tell the agent to run device commands through the terminal:

```json
{
  "mcpServers": {
    "agent-device": {
      "command": "agent-device",
      "args": ["mcp"]
    }
  }
}
```

If the client has project rules or custom instructions, add the recommended agent rule above. If it does not, start the conversation by asking the agent to run `agent-device help workflow` before planning.

## What agent-device is good at

- AI mobile testing and app QA from coding agents.
- Local iOS, Android, tvOS, Android TV, macOS, and Linux desktop app automation.
- Token-efficient UI understanding through accessibility snapshots instead of screenshot-only reasoning.
- Deterministic interactions with current-screen refs and selector-backed replay.
- Debug evidence collection: screenshots, video, logs, network traffic, traces, CPU/memory/perf snapshots, crash-related logs, and React Native render profiles.
- Turning exploratory agent sessions into `.ad` replay scripts that can run later without AI.

## Where it is different

`agent-device` is not a general-purpose mobile MCP that exposes every device action as an MCP tool. The MCP surface is intentionally small so discovery, installation, and help are easy while automation remains explicit CLI activity in the terminal.

`agent-device` is also not a replacement for every human-authored test framework. Keep Appium, Maestro, Detox, XCTest, Espresso, or Playwright-style tests when you already have stable scripted coverage. Use `agent-device` when an agent needs to inspect a real app, interact with visible UI, debug runtime behavior, capture evidence, or record a replay from exploration.

## Agent-readable docs

Use [llms-full.txt](https://incubator.callstack.com/agent-device/llms-full.txt) when an agent needs a single text bundle of the current docs. The installed CLI remains authoritative for exact command syntax:

```bash
agent-device help
agent-device help workflow
agent-device help dogfood
```
