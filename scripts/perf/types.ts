// Shared data shapes for the e2e perf benchmark harness.

export type Platform = 'ios' | 'android';

export type ExecMode = 'batch' | 'standalone';

export type CliResult = {
  exitCode: number;
  wallClockMs: number; // measured by the harness around the child process
  stdout: string;
  stderr: string;
  json: unknown; // parsed --json payload (or undefined when not parseable)
  ok: boolean; // exit 0 AND (json.ok !== false)
};

export type Sample = {
  round: number;
  wallClockMs: number;
  daemonDurationMs?: number; // from batch results[0].durationMs (batch mode only)
  elementCount?: number; // for snapshot rows: parsed @eN count, a tree-size proxy
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
};

export type Stat = { n: number; min: number; median: number; p95: number; max: number };

export type Measurement = {
  command: string;
  label: string;
  platform: Platform;
  execMode: ExecMode;
  samples: Sample[]; // kept samples only (warmup rounds dropped)
  warmupDropped: number;
  wallClock: Stat | null;
  daemonDuration: Stat | null; // null for standalone or when no ok samples
  elementCount: Stat | null; // null unless snapshot row
  failures: number;
  notes: string[];
};

export type RunResult = {
  startedAt: string;
  finishedAt: string;
  platform: Platform;
  device: { udid?: string; serial?: string; name: string };
  config: { rounds: number; warmup: number; keepArtifacts: boolean };
  agentDeviceVersion: string;
  measurements: Measurement[];
};
