const COMMAND_DESCRIPTIONS = {
  devices: 'List available devices.',
  boot: 'Boot or prepare a selected device without using CLI positional arguments.',
  apps: 'List installed apps.',
  session: 'List active sessions.',
  open: 'Open an app, deep link, URL, or platform surface.',
  prepare: 'Prepare platform helper infrastructure.',
  close: 'Close an app or end the active session.',
  install: 'Install an app binary.',
  reinstall: 'Reinstall an app binary.',
  'install-from-source': 'Install an app from a structured source.',
  push: 'Deliver a push payload.',
  'trigger-app-event': 'Trigger an app-defined event.',
  snapshot: 'Capture an accessibility snapshot.',
  screenshot: 'Capture a screenshot.',
  diff: 'Diff accessibility snapshots.',
  wait: 'Wait for duration, text, ref, or selector.',
  alert: 'Inspect or handle platform alerts.',
  appstate: 'Show foreground app or activity.',
  back: 'Navigate back.',
  home: 'Go to the home screen.',
  rotate: 'Rotate device orientation.',
  'app-switcher': 'Open the app switcher.',
  keyboard: 'Inspect or dismiss the keyboard.',
  clipboard: 'Read or write clipboard text.',
  'react-native': 'Run supported React Native app automation helpers.',
  replay: 'Replay a recorded session.',
  test: 'Run one or more replay scripts.',
  perf: 'Show session performance metrics and frame health.',
  logs: 'Manage session app logs.',
  network: 'Show recent HTTP traffic.',
  record: 'Start or stop screen recording.',
  trace: 'Start or stop trace capture.',
  settings: 'Change OS settings and app permissions.',
  metro: 'Prepare Metro runtime or reload React Native apps.',
  click: 'Click or tap a semantic UI target by ref, selector, or point.',
  press: 'Press a semantic UI target by ref, selector, or point.',
  fill: 'Fill text into a semantic UI target by ref, selector, or point.',
  longpress: 'Long press by ref, selector, or point.',
  swipe: 'Swipe between two points.',
  focus: 'Focus input at coordinates.',
  type: 'Type text in the focused field.',
  scroll: 'Scroll in a direction or to an edge.',
  get: 'Get element text or attributes.',
  is: 'Assert UI state.',
  find: 'Find an element and optionally act on it.',
  gesture: 'Run a structured gesture.',
  batch: 'Run multiple structured command steps in one daemon request.',
} as const;

export type DescribedCommandName = keyof typeof COMMAND_DESCRIPTIONS;

function getCommandDescription(command: string): string | undefined {
  return COMMAND_DESCRIPTIONS[command as DescribedCommandName];
}

export function requireCommandDescription(command: string): string {
  const description = getCommandDescription(command);
  if (!description) throw new Error(`Missing command description for ${command}`);
  return description;
}

export function listCommandDescriptionMetadata(): Array<{
  name: DescribedCommandName;
  description: string;
}> {
  return Object.entries(COMMAND_DESCRIPTIONS).map(([name, description]) => ({
    name: name as DescribedCommandName,
    description,
  }));
}
