---
title: AI Agent Setup
description: Configure Cursor, Codex, Claude Code, Windsurf, Cline, Goose, skills, and MCP for agent-device mobile, TV, and desktop app verification.
---

# AI Agent Setup

`agent-device` is built for AI agents, but humans usually install it, grant device permissions, and decide which agent client should use it.

Use this page to wire Cursor, Codex, Claude Code, Windsurf, Cline, Goose, or another coding agent into mobile, TV, and desktop app verification. It covers skills, project rules, and MCP setup for React Native QA, Expo app verification, iOS Simulator automation, Android Emulator automation, tvOS checks, Android TV checks, debugging, profiling, and exploratory QA.

The short version: install the CLI, make the agent read version-matched help, and let the agent run CLI commands in a terminal. MCP is available for discovery and help, not broad device control.

## Prerequisite: install the CLI

```bash
npm install -g agent-device@latest
agent-device --version
agent-device help workflow
```

For one-off human use without a global install:

```bash
npx agent-device --version
npx agent-device help workflow
```

Global install is better for normal agent workflows because repeated commands, skills, and terminal sessions resolve to one stable version. Project-local installs are also good when you want a lockfile-pinned agent-device version.

Avoid telling agents to choose an npm version or run `npx -y agent-device@latest` autonomously: it fetches and executes a mutable npm package without a human prompt. For unattended agent use, prefer a trusted installed binary, a project-local install, or a version supplied by the user or project config.

For Node, Xcode, Android SDK, macOS, and iOS device prerequisites, see [Installation](/docs/installation).

## Install the skill

Install the skill when your agent runtime supports skills:

```bash
npx skills add callstackincubator/agent-device
```

The bundled [agent-device skill](https://github.com/callstackincubator/agent-device/blob/main/skills/agent-device/SKILL.md) is the canonical router for skill-aware clients. It intentionally points agents back to installed CLI help instead of duplicating the command manual.

## Recommended agent rule

Add this as a project rule, custom instruction, or skill equivalent when your agent client supports it:

```text
Use agent-device only for app/device automation tasks. Before planning commands, run `agent-device --version` and read `agent-device help workflow`. For exploratory QA, read `agent-device help dogfood`. For logs, network, traces, or runtime failures, read `agent-device help debugging`. For React Native component trees, props/state/hooks, slow renders, or rerenders, read `agent-device help react-devtools`. For React Native apps, overlays, Metro/Fast Refresh blockers, and routing to React DevTools or debugging evidence, read `agent-device help react-native`.

Use the CLI in the integrated terminal. If `agent-device` is not on PATH but the user installed it globally in another shell, resolve the command the same way the user would from a normal terminal session and run that absolute path instead. This may require inspecting shell startup behavior or package-manager/global bin locations; do not assume the agent process `PATH` is the user's `PATH`. Do not silently fall back to `npx -y agent-device@latest`; ask or use an exact version. MCP is discovery-only, exposes only status handoff metadata, and does not expose device automation tools. Prefer `open -> snapshot -i -> act -> re-snapshot -> verify -> close`. Use current refs such as `@e3` for exploration and selectors for durable replay. Keep mutating commands against one session serial. Capture screenshots, logs, network, perf, traces, recordings, and `.ad` replay scripts only when they add evidence.
```

## MCP router

`agent-device mcp` starts the official stdio MCP router for discovery-oriented clients. It exposes only a `status` tool that returns structured CLI handoff guidance: npm package name, installed version, CLI command name, install command, verify command, starting help command, and an explicit note that automation happens through the CLI.

MCP clients must not use this server as a device automation surface or generic shell runner. If the CLI is missing, agents should ask a human before installing or updating packages, then verify with `agent-device --version` and start with `agent-device help workflow`.

Global install configuration:

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

No global install variant. Pin a user- or project-selected package version for unattended agent use:

```json
{
  "mcpServers": {
    "agent-device": {
      "command": "npx",
      "args": ["-y", "agent-device@<reviewed-version>", "mcp"]
    }
  }
}
```

Registry metadata uses MCP name `io.github.callstackincubator/agent-device`, npm package `agent-device`, stdio transport, `mcpName` package verification, `server.json`, and `smithery.yaml`.

## Cursor

Use Agent mode with the integrated terminal. Add the recommended rule above as a project rule, then run:

```bash
agent-device help workflow
agent-device apps --platform ios
agent-device open <app-or-url> --platform ios
agent-device snapshot -i
```

Optional: paste the [MCP router](#mcp-router) configuration into `.cursor/mcp.json`.

## Codex

Put the recommended rule in `AGENTS.md` or the project instructions. Let Codex run `agent-device` in the terminal:

```bash
agent-device help workflow
agent-device boot --platform ios
agent-device open <app-or-url> --platform ios
agent-device snapshot -i
```

Some agent clients run commands in an environment that differs from the user's normal install shell. If the user installed `agent-device` globally but the agent cannot find it, resolve the command the same way the user would from a normal terminal session, then use the absolute binary path for `--version`, `help workflow`, and subsequent commands. This may require inspecting shell startup behavior or package-manager/global bin locations; do not assume the agent process `PATH` is the user's `PATH`.

For reviews or planning-only tasks, tell the agent not to run devices unless explicitly requested.

## Claude Code

Use the bundled skill when your Claude setup supports skills. Otherwise put the recommended rule in `CLAUDE.md`.

```bash
agent-device --version
agent-device help workflow
agent-device help dogfood
agent-device help react-native
```

If you configure MCP, keep using CLI commands for automation. The MCP router gives Claude discovery/status handoff metadata only.

## Windsurf, Cline, Goose, and other MCP clients

Use the [MCP router](#mcp-router) configuration when the client supports `mcpServers`, then tell the agent to run device commands through the terminal.

If the client has project rules or custom instructions, add the recommended agent rule above. If it does not, start the conversation by asking the agent to run `agent-device help workflow` before planning.

## Why this setup works

The CLI stays the auditable automation surface, installed help stays version-matched with the commands, skills and rules route agents toward the right help topics, and MCP gives discovery-oriented clients a small status handoff entry point.

For the broader positioning, supported targets, observability features, and how `agent-device` differs from scripted test frameworks, see [Introduction](/docs/introduction). For exact command groups and platform behavior, see [Commands](/docs/commands).

For the local execution model, permissions, artifacts, and sensitive data guidance, see [Security & Trust](/docs/security-trust).

## Agent-readable docs

Use [llms-full.txt](https://incubator.callstack.com/agent-device/llms-full.txt) when an agent needs a single text bundle of the current docs. The installed CLI remains authoritative for exact command syntax:

```bash
agent-device help
agent-device help workflow
agent-device help dogfood
```
