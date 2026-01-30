# iOS Runner Protocol (v1)

The iOS XCTest runner accepts a single HTTP request, processes one command, and exits.

## Request

- Method: `POST`
- Path: `/command` (not strictly validated)
- Body: JSON

### JSON schema (conceptual)

```json
{
  "command": "tap|type|swipe|findText|listTappables",
  "appBundleId": "com.apple.Preferences",
  "text": "Apps",
  "x": 100,
  "y": 200,
  "direction": "up|down|left|right"
}
```

Fields by command:
- `tap`: provide either `text` or `x` + `y`.
- `type`: requires `text`.
- `swipe`: requires `direction`.
- `findText`: requires `text`.
- `listTappables`: no extra fields.

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
