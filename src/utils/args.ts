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
  press <x> <y>
  long-press <x> <y> [durationMs]
  focus <x> <y>
  type <text>
  fill <x> <y> <text>
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
`;
}
