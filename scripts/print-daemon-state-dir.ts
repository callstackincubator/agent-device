import { resolveDaemonPaths } from '../src/daemon/config.ts';

const paths = resolveDaemonPaths(process.env.AGENT_DEVICE_STATE_DIR);

process.stdout.write(`${paths.baseDir}\n`);
