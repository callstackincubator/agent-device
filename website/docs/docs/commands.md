---
title: Commands
---

# Commands

This page summarizes the primary command groups.

## Navigation

```bash
agent-device open [app]
agent-device close [app]
agent-device back
agent-device home
agent-device app-switcher
```

## Snapshot and inspect

```bash
agent-device snapshot [-i] [-c] [-d <depth>] [-s <scope>] [--raw] [--backend ax|xctest]
agent-device get text @e1
agent-device get attrs @e1
```

## Interactions

```bash
agent-device click @e1
agent-device focus @e2
agent-device fill @e2 "text"
agent-device type "text"
agent-device press 300 500
agent-device long-press 300 500 800
agent-device scroll down 0.5
```

## Find (semantic)

```bash
agent-device find "Sign In" click
agent-device find label "Email" fill "user@example.com"
agent-device find role button click
```

## Settings helpers

```bash
agent-device settings wifi on
agent-device settings wifi off
agent-device settings airplane on
agent-device settings airplane off
agent-device settings location on
agent-device settings location off
```