---
title: Introduction
---

# Introduction

`agent-device` is a CLI for automating iOS simulators and Android emulators (and devices) from agents. It provides:

- Accessibility snapshots for UI understanding
- Deterministic interactions (tap, type, scroll)
- Session-aware workflows and replay

If you know `agent-browser`, this is the mobile-native counterpart focused on simulators and emulators.

## What it’s good at

- Capturing structured UI state for LLMs
- Driving common UI actions with refs or semantic selectors
- Replaying flows for regression checks

## Architecture (high level)

1. CLI sends requests to the daemon.
2. The daemon manages sessions and dispatches to platform drivers.
3. iOS uses XCTest runner for snapshots and input; AX is optional fallback.
4. Android uses ADB-based tooling.
