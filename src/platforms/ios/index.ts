// --- iOS simulator & device automation ---
export {
  closeIosApp,
  installIosApp,
  installIosInstallablePath,
  listIosApps,
  listSimulatorApps,
  openIosApp,
  openIosDevice,
  pushIosNotification,
  readIosClipboardText,
  reinstallIosApp,
  resolveIosApp,
  screenshotIos,
  setIosSetting,
  uninstallIosApp,
  writeIosClipboardText,
} from './apps.ts';

export { ensureBootedSimulator } from './simulator.ts';

export { parseIosDeviceAppsPayload, type IosAppInfo } from './devicectl.ts';

// --- macOS desktop automation ---
// These exports handle macOS native app automation (not iOS simulators).
// They live in the ios/ directory because they share the XCTest runner infrastructure.
// Consumed directly via ./macos-apps.ts and ./macos-helper.ts rather than through
// this barrel — see those modules for macOS-specific app management, permissions,
// snapshot actions, and helper process coordination.
