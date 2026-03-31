import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type PackageMetadata = {
  name: string;
  version: string;
};

export function readVersion(): string {
  return readPackageMetadata().version;
}

export function readPackageMetadata(): PackageMetadata {
  try {
    const root = findProjectRoot();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      name?: string;
      version?: string;
    };
    return {
      name: pkg.name ?? 'agent-device',
      version: pkg.version ?? '0.0.0',
    };
  } catch {
    return {
      name: 'agent-device',
      version: '0.0.0',
    };
  }
}

export function findProjectRoot(): string {
  const start = path.dirname(fileURLToPath(import.meta.url));
  let current = start;
  for (let i = 0; i < 6; i += 1) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) return current;
    current = path.dirname(current);
  }
  return start;
}
