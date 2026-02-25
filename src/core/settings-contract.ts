export const SETTINGS_WIFI_USAGE = '<wifi|airplane|location> <on|off>';
export const SETTINGS_APPEARANCE_USAGE = 'appearance <light|dark|toggle>';
export const SETTINGS_FACEID_USAGE = 'faceid <match|nonmatch|enroll|unenroll>';
export const SETTINGS_TOUCHID_USAGE = 'touchid <match|nonmatch|enroll|unenroll>';
export const SETTINGS_FINGERPRINT_USAGE = 'fingerprint <match|nonmatch>';
export const SETTINGS_PERMISSION_USAGE =
  'permission <grant|deny|reset> <camera|microphone|photos|contacts|contacts-limited|notifications|calendar|location|location-always|media-library|motion|reminders|siri> [full|limited]';

export const SETTINGS_USAGE_OVERRIDE = [
  `settings ${SETTINGS_WIFI_USAGE}`,
  `settings ${SETTINGS_APPEARANCE_USAGE}`,
  `settings ${SETTINGS_FACEID_USAGE}`,
  `settings ${SETTINGS_TOUCHID_USAGE}`,
  `settings ${SETTINGS_FINGERPRINT_USAGE}`,
  `settings ${SETTINGS_PERMISSION_USAGE}`,
].join(' | ');

export const SETTINGS_INVALID_ARGS_MESSAGE =
  `settings requires ${SETTINGS_WIFI_USAGE}, ${SETTINGS_APPEARANCE_USAGE}, ${SETTINGS_FACEID_USAGE}, ${SETTINGS_TOUCHID_USAGE}, ${SETTINGS_FINGERPRINT_USAGE}, or ${SETTINGS_PERMISSION_USAGE}`;
