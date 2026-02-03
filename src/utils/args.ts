import { AppError } from './errors.ts';

export type ParsedArgs = {
  command: string | null;
  positionals: string[];
  flags: {
    json: boolean;
    platform?: 'ios' | 'android';
    device?: string;
    udid?: string;
    serial?: string;
    out?: string;
    session?: string;
    verbose?: boolean;
    snapshotInteractiveOnly?: boolean;
    snapshotCompact?: boolean;
    snapshotDepth?: number;
    snapshotScope?: string;
    snapshotRaw?: boolean;
    snapshotBackend?: 'ax' | 'xctest' | 'hybrid';
    appsFilter?: 'launchable' | 'user-installed' | 'all';
    noRecord?: boolean;
    recordJson?: boolean;
    help: boolean;
  };
};

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: ParsedArgs['flags'] = { json: false, help: false };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '--verbose' || arg === '-v') {
      flags.verbose = true;
      continue;
    }
    if (arg === '-i') {
      flags.snapshotInteractiveOnly = true;
      continue;
    }
    if (arg === '-c') {
      flags.snapshotCompact = true;
      continue;
    }
    if (arg === '--raw') {
      flags.snapshotRaw = true;
      continue;
    }
    if (arg === '--no-record') {
      flags.noRecord = true;
      continue;
    }
    if (arg === '--record-json') {
      flags.recordJson = true;
      continue;
    }
    if (arg === '--user-installed') {
      flags.appsFilter = 'user-installed';
      continue;
    }
    if (arg === '--all') {
      flags.appsFilter = 'all';
      continue;
    }
    if (arg.startsWith('--backend')) {
      const value = arg.includes('=')
        ? arg.split('=')[1]
        : argv[i + 1];
      if (!arg.includes('=')) i += 1;
      if (value !== 'ax' && value !== 'xctest' && value !== 'hybrid') {
        throw new AppError('INVALID_ARGS', `Invalid backend: ${value}`);
      }
      flags.snapshotBackend = value;
      continue;
    }
    if (arg.startsWith('--')) {
      const [key, valueInline] = arg.split('=');
      const value = valueInline ?? argv[i + 1];
      if (!valueInline) i += 1;

      switch (key) {
        case '--platform':
          if (value !== 'ios' && value !== 'android') {
            throw new AppError('INVALID_ARGS', `Invalid platform: ${value}`);
          }
          flags.platform = value;
          break;
        case '--depth': {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 0) {
            throw new AppError('INVALID_ARGS', `Invalid depth: ${value}`);
          }
          flags.snapshotDepth = Math.floor(parsed);
          break;
        }
        case '--scope':
          flags.snapshotScope = value;
          break;
        case '--device':
          flags.device = value;
          break;
        case '--udid':
          flags.udid = value;
          break;
        case '--serial':
          flags.serial = value;
          break;
        case '--out':
          flags.out = value;
          break;
        case '--session':
          flags.session = value;
          break;
        default:
          throw new AppError('INVALID_ARGS', `Unknown flag: ${key}`);
      }
      continue;
    }
    if (arg === '-d') {
      const value = argv[i + 1];
      i += 1;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new AppError('INVALID_ARGS', `Invalid depth: ${value}`);
      }
      flags.snapshotDepth = Math.floor(parsed);
      continue;
    }
    if (arg === '-s') {
      const value = argv[i + 1];
      i += 1;
      flags.snapshotScope = value;
      continue;
    }
    positionals.push(arg);
  }

  const command = positionals.shift() ?? null;
  return { command, positionals, flags };
}

export function usage(): string {
  return `agent-device <command> [args] [--json]

CLI to control iOS and Android devices for AI agents.

Commands:
  open [app]                                 Boot device/simulator; optionally launch app
  close [app]                                Close app or just end session
  snapshot [-i] [-c] [-d <depth>] [-s <scope>] [--raw] [--backend ax|xctest|hybrid]
                                             Capture accessibility tree
    -i                                       Interactive elements only
    -c                                       Compact output (drop empty structure)
    -d <depth>                               Limit snapshot depth
    -s <scope>                               Scope snapshot to label/identifier
    --raw                                    Raw node output
    --backend ax|xctest|hybrid               hybrid: default; AX snapshot with XCTest fill for empty containers
                                             ax: macOS Accessibility tree (fast, needs permissions)
                                             xctest: XCTest snapshot (slower, no permissions)
  devices                                   List available devices
  apps [--user-installed|--all]             List installed apps (Android launchable by default, iOS simulator)
  back                                      Navigate back (where supported)
  home                                      Go to home screen (where supported)
  app-switcher                              Open app switcher (where supported)
  wait <ms>|text <text>|@ref [timeoutMs]     Wait for duration or text to appear
  alert [get|accept|dismiss|wait] [timeout] Inspect or handle alert (iOS simulator)
  click <@ref>                               Click element by snapshot ref
  get text <@ref>                            Return element text by ref
  get attrs <@ref>                           Return element attributes by ref
  replay <path>                              Replay a recorded session
  press <x> <y>                              Tap at coordinates
  long-press <x> <y> [durationMs]            Long press (where supported)
  focus <x> <y>                              Focus input at coordinates
  type <text>                                Type text in focused field
  fill <x> <y> <text> | fill <@ref> <text>   Tap then type
  scroll <direction> [amount]                Scroll in direction (0-1 amount)
  scrollintoview <text>                      Scroll until text appears (Android only)
  screenshot [--out path]                    Capture screenshot
  record start [path]                        Start screen recording
  record stop                                Stop screen recording
  trace start [path]                         Start trace log capture
  trace stop [path]                          Stop trace log capture
  find <text> <action> [value]               Find by any text (label/value/id)
  find text <text> <action> [value]          Find by text content
  find label <label> <action> [value]        Find by label
  find value <value> <action> [value]        Find by value
  find role <role> <action> [value]          Find by role/type
  find id <id> <action> [value]              Find by identifier/resource-id
  settings <wifi|airplane|location> <on|off> Toggle OS settings (simulators)
  session list                               List active sessions

Flags:
  --platform ios|android                     Platform to target
  --device <name>                            Device name to target
  --udid <udid>                              iOS device UDID
  --serial <serial>                          Android device serial
  --out <path>                               Output path for screenshots
  --session <name>                           Named session
  --verbose                                  Stream daemon/runner logs
  --json                                     JSON output
  --no-record                                Do not record this action
  --record-json                              Record JSON session log
  --user-installed                           Apps: list user-installed packages (Android only)
  --all                                      Apps: list all packages (Android only)
`;
}
