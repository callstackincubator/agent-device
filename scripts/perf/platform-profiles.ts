import type { PerfConfig } from './config.ts';
import type { Platform } from './types.ts';

// Local-convenience defaults for ad-hoc runs; CI always overrides them (--device / --serial).
// The iOS UDID is a specific local "iPhone 17" sim; the Android serial is a dedicated emulator
// port. Pass --udid/--device/--serial to target your own device.
const DEFAULT_IOS_UDID = 'D74E0B66-57EB-4EC1-92DC-DA0A30581FE7';
const DEFAULT_ANDROID_SERIAL = 'emulator-5556';

export type ProfileSelectors = {
  // A row on the Settings root that pushes a large sub-screen (big a11y tree).
  deepScreen: string;
  // The Settings search field (for press/focus; auto-picks a match).
  searchField: string;
  // A selector that uniquely targets the EDITABLE search field (for fill).
  searchFieldEditable: string;
  // iOS exposes an editable search field at the Settings root (fill works without focusing
  // first; focusing then filling can hang). Android only reveals the editable after tapping
  // the search card, so it must press the search entry before fill/type.
  searchEditableAtRoot: boolean;
  // A label reliably visible on the Settings root, for get/is (selector form).
  anchorLabel: string;
  // Plain text of the anchor, for wait text / find (not a selector).
  anchorText: string;
};

export type ResolvedProfile = {
  platform: Platform;
  deviceName: string;
  udid?: string;
  serial?: string;
  platformFlags: string[]; // --platform; applied to every call (only conflicts if it mismatches a locked session)
  selectorFlags: string[]; // device selectors — ONLY on the session-establishing open / selectorless boot
  appTarget: string; // `open` target for Settings
  selectors: ProfileSelectors;
};

export function resolveProfile(cfg: PerfConfig): ResolvedProfile {
  if (cfg.platform === 'ios') {
    // Prefer targeting by device name (CI boots a named simulator); fall back to a UDID.
    const useName = cfg.device !== undefined;
    const udid = useName ? undefined : (cfg.udid ?? DEFAULT_IOS_UDID);
    return {
      platform: 'ios',
      deviceName: cfg.device ?? 'iPhone 17',
      udid,
      platformFlags: ['--platform', 'ios'],
      selectorFlags: useName ? ['--device', cfg.device!] : ['--udid', udid!],
      appTarget: 'settings',
      selectors: {
        deepScreen: 'label="General"',
        searchField: 'label="Search"',
        searchFieldEditable: 'label="Search" editable',
        searchEditableAtRoot: true,
        anchorLabel: 'label="General"',
        anchorText: 'General',
      },
    };
  }
  const serial = cfg.serial ?? DEFAULT_ANDROID_SERIAL;
  return {
    platform: 'android',
    deviceName: cfg.serial ? `android (${serial})` : 'Pixel_9_Pro_XL_API_37',
    serial,
    platformFlags: ['--platform', 'android'],
    selectorFlags: ['--serial', serial, '--android-device-allowlist', serial],
    appTarget: 'com.android.settings',
    selectors: {
      deepScreen: 'text="Network & internet"',
      searchField: 'text="Search Settings"',
      searchFieldEditable: 'editable',
      searchEditableAtRoot: false,
      anchorLabel: 'label="Network & internet"',
      anchorText: 'Network & internet',
    },
  };
}
