# serve-sim camera vendor

This directory vendors the iOS simulator camera helper and injector from
`serve-sim`.

- Upstream: https://github.com/EvanBacon/serve-sim
- Imported package: `serve-sim@0.1.34`
- License: Apache-2.0, copied in `LICENSE`
- Imported paths:
  - `bin/camera-injector.dylib`
  - `bin/camera-helper`

The imported binaries were renamed locally to avoid exposing upstream internal
artifact names in this codebase.

Local integration code lives outside this directory. Keep local modifications
to vendored artifacts minimal; when changing copied upstream artifacts,
document the change here and preserve Apache-2.0 attribution.

Current local modifications: none.
