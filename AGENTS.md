# AGENTS.md

Instructions for AI coding agents working with this codebase.

## Code Style

- Do not use emojis in code, output, or documentation. Unicode symbols (✓, ✗, →, ⚠) are acceptable.
- Use `runCmd`/`runCmdSync` from `src/utils/exec.ts` for process execution; avoid direct `spawn`/`spawnSync`.
- Commands should use the daemon session model; open a session before interactions and close it after.
