#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = join(here, '..', 'dist', 'src', 'bin.js');

if (!existsSync(distPath)) {
  process.stderr.write('Missing dist build. Run `pnpm build` before using the binary.\n');
  process.exit(1);
}

await import(pathToFileURL(distPath).href);
