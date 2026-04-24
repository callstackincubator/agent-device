import { runCmdStreaming } from '../../utils/exec.ts';

export const AGENT_REACT_DEVTOOLS_VERSION = '0.4.0';
export const AGENT_REACT_DEVTOOLS_PACKAGE = `agent-react-devtools@${AGENT_REACT_DEVTOOLS_VERSION}`;
const AGENT_REACT_DEVTOOLS_BIN = 'agent-react-devtools';

export function buildReactDevtoolsNpmExecArgs(args: string[]): string[] {
  return [
    'exec',
    '--yes',
    '--package',
    AGENT_REACT_DEVTOOLS_PACKAGE,
    '--',
    AGENT_REACT_DEVTOOLS_BIN,
    ...args,
  ];
}

export async function runReactDevtoolsCommand(args: string[]): Promise<number> {
  const result = await runCmdStreaming('npm', buildReactDevtoolsNpmExecArgs(args), {
    cwd: process.cwd(),
    env: process.env,
    allowFailure: true,
    onStdoutChunk: (chunk) => {
      process.stdout.write(chunk);
    },
    onStderrChunk: (chunk) => {
      process.stderr.write(chunk);
    },
  });
  return result.exitCode;
}
