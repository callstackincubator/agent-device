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
    snapshotBackend?: 'ax' | 'xctest';
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
    if (arg.startsWith('--backend')) {
      const value = arg.includes('=')
        ? arg.split('=')[1]
        : argv[i + 1];
      if (!arg.includes('=')) i += 1;
      if (value !== 'ax' && value !== 'xctest') {
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

Commands:
  open <app>
  close [app]
  snapshot [-i] [-c] [-d <depth>] [-s <scope>] [--raw] [--backend ax|xctest]
  click <@ref>
  get text <@ref>
  get attrs <@ref>
  replay <path>
  press <x> <y>
  long-press <x> <y> [durationMs]
  focus <x> <y>
  type <text>
  fill <x> <y> <text> | fill <@ref> <text>
  scroll <direction> [amount]
  scrollintoview <text>
  screenshot [--out path]
  session list

Flags:
  --platform ios|android
  --device <name>
  --udid <udid>
  --serial <serial>
  --out <path>
  --session <name>
  --verbose
  --json
  --no-record
  --record-json
`;
}
