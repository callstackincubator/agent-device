# iOS Runner Protocol (v1)

The iOS XCTest runner accepts HTTP requests, processes commands, and stays alive for the session until a shutdown command.

## Request

- Method: `POST`
- Path: `/command` (not strictly validated)
- Body: JSON

### JSON schema (conceptual)

```json
{
  "command": "tap|type|swipe|snapshot|findText|listTappables|shutdown",
  "appBundleId": "com.apple.Preferences",
  "text": "Apps",
  "x": 100,
  "y": 200,
  "direction": "up|down|left|right",
  "options": { "onlyInteractive": true, "compact": true, "maxDepth": 8, "scope": "Camera" }
}
```

Fields by command:
- `tap`: provide either `text` or `x` + `y`.
- `type`: requires `text`.
- `swipe`: requires `direction`.
- `snapshot`: optional `options`.
- `findText`: requires `text`.
- `listTappables`: no extra fields.
- `shutdown`: no extra fields.

## Response

```json
{
  "ok": true,
  "data": { "message": "tapped" }
}
```

Errors return:

```json
{
  "ok": false,
  "error": { "message": "..." }
}
```

Data payload may include:
- `message`: string
- `found`: boolean (for `findText`)
- `items`: array of strings (for `listTappables`)
- `tree`: snapshot nodes (for `snapshot`)
