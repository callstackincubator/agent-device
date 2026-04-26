#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distPaths = [
  join(here, '..', 'dist', 'src', 'internal', 'bin.js'),
  join(here, '..', 'dist', 'src', 'bin.js'),
];
const distPath = distPaths.find((candidate) => existsSync(candidate));

if (!distPath) {
  process.stderr.write('Missing dist build. Run `pnpm build` before using the binary.\n');
  process.exit(1);
}

await import(pathToFileURL(distPath).href);
