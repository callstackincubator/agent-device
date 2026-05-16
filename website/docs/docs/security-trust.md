---
title: Security & Trust
description: Security and trust guidance for agent-device local app automation, device permissions, screenshots, recordings, logs, network dumps, traces, and reports.
---

# Security & Trust

`agent-device` runs locally by default and controls the devices, simulators, emulators, and desktop apps available to the current user. Treat it like any other developer tool that can interact with apps, capture screens, and read diagnostic output.

## Local control

- Device automation runs through the installed CLI and platform tooling such as Xcode, ADB, macOS accessibility APIs, and Linux AT-SPI.
- Mutating commands should run serially against one session. Use separate sessions/devices for parallel work.

## Sensitive artifacts

Screenshots, recordings, traces, logs, network dumps, replay files, and reports can contain private UI state, credentials, tokens, request data, or customer information. Store them in a controlled directory, review before sharing, and avoid committing artifacts unless they are intentionally sanitized fixtures.

## Permissions

Some targets require local permissions or developer setup:

- iOS/tvOS/macOS automation uses Xcode tooling and may require signing or Developer Mode for physical devices.
- Android automation uses ADB and connected emulator/device trust.
- macOS desktop automation requires Accessibility permission, and screen capture workflows may require Screen Recording permission.

## Network and updates

Interactive CLI runs may check npm for newer `agent-device` releases and print an upgrade suggestion. Set `AGENT_DEVICE_NO_UPDATE_NOTIFIER=1` to disable the notice.

Network inspection commands only collect traffic available to the active app/session tooling. Review network artifacts before sharing because headers and payloads can contain secrets.

## Responsible disclosure

Report security issues by contacting Callstack privately at hello@callstack.com. Do not open a public issue for a vulnerability that exposes user data, credentials, device access, or remote execution risk.
