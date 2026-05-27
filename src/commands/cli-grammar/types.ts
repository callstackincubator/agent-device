import type { InteractionTarget, InternalRequestOptions } from '../../client-types.ts';
import type { CliFlags } from '../../utils/command-schema.ts';

export type DaemonCommandRequest = {
  command: string;
  positionals: string[];
  options: InternalRequestOptions;
};

export type CommandInput = InternalRequestOptions & Record<string, any>;

export type SelectionOptions = {
  platform?: CliFlags['platform'];
  target?: CliFlags['target'];
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
};

export type CliInput = Record<string, unknown>;
export type CliReader = (positionals: string[], flags: CliFlags) => CliInput;
export type DaemonWriter = (input: CommandInput) => DaemonCommandRequest;

export type DecodedFillTarget =
  | { kind: 'ref'; target: { ref: string; label?: string }; text: string }
  | { kind: 'selector'; target: { selector: string }; text: string }
  | { kind: 'point'; target: { x: number; y: number }; text: string };

export type WaitParsed =
  | { kind: 'sleep'; durationMs: number }
  | { kind: 'ref'; rawRef: string; timeoutMs: number | null }
  | { kind: 'selector'; selectorExpression: string; timeoutMs: number | null }
  | { kind: 'text'; text: string; timeoutMs: number | null };

export type { InteractionTarget };
