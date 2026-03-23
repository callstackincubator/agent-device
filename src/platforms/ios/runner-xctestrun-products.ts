import fs from 'node:fs';
import path from 'node:path';
import { runCmdSync } from '../../utils/exec.ts';

export function xctestrunReferencesExistingProducts(xctestrunPath: string): boolean {
  try {
    return resolveExistingXctestrunProductPaths(xctestrunPath) !== null;
  } catch {
    return false;
  }
}

export function resolveExistingXctestrunProductPaths(xctestrunPath: string): string[] | null {
  const values = resolveXctestrunProductReferences(xctestrunPath);
  if (!values || values.length === 0) {
    return null;
  }
  const testRoot = path.dirname(xctestrunPath);
  const resolvedPaths = new Set<string>();
  const hostRoots = new Set<string>();
  const hostRelativePaths: string[] = [];

  for (const value of values) {
    if (value.startsWith('__TESTROOT__/')) {
      const relativePath = value.slice('__TESTROOT__/'.length);
      const resolvedPath = path.join(testRoot, relativePath);
      if (!fs.existsSync(resolvedPath)) {
        return null;
      }
      resolvedPaths.add(resolvedPath);
      const appBundleRoot = extractAppBundleRoot(relativePath);
      if (appBundleRoot) {
        hostRoots.add(path.join(testRoot, appBundleRoot));
      }
      continue;
    }
    if (value.startsWith('__TESTHOST__/')) {
      hostRelativePaths.push(value.slice('__TESTHOST__/'.length));
    }
  }

  for (const relativePath of hostRelativePaths) {
    const resolvedHostRoot = Array.from(hostRoots).find((hostRoot) =>
      fs.existsSync(path.join(hostRoot, relativePath)),
    );
    if (!resolvedHostRoot) {
      return null;
    }
    resolvedPaths.add(path.join(resolvedHostRoot, relativePath));
  }

  return Array.from(resolvedPaths);
}

function resolveXctestrunProductReferences(xctestrunPath: string): string[] | null {
  const parsed = readXctestrunJson(xctestrunPath);
  if (parsed) {
    return resolveXctestrunProductReferencesFromJson(parsed);
  }
  if (process.platform === 'darwin') {
    return null;
  }
  try {
    // Keep a simple XML fallback only for non-macOS test environments where plutil is absent.
    return resolveXctestrunProductReferencesFromXml(fs.readFileSync(xctestrunPath, 'utf8'));
  } catch {
    return null;
  }
}

function readXctestrunJson(xctestrunPath: string): Record<string, unknown> | null {
  try {
    const result = runCmdSync('plutil', ['-convert', 'json', '-o', '-', xctestrunPath], {
      allowFailure: true,
    });
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return null;
    }
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveXctestrunProductReferencesFromJson(parsed: Record<string, unknown>): string[] {
  const values = new Set<string>();
  const addTargetValues = (target: unknown) => {
    if (!target || typeof target !== 'object') {
      return;
    }
    for (const value of collectXctestrunProductReferenceValuesFromTarget(
      target as Record<string, unknown>,
    )) {
      values.add(value);
    }
  };

  addTargetValues(parsed);

  const testConfigurations = parsed.TestConfigurations;
  if (Array.isArray(testConfigurations)) {
    for (const config of testConfigurations) {
      if (!config || typeof config !== 'object') {
        continue;
      }
      const testTargets = (config as Record<string, unknown>).TestTargets;
      if (!Array.isArray(testTargets)) {
        continue;
      }
      for (const target of testTargets) {
        addTargetValues(target);
      }
    }
  }

  for (const value of Object.values(parsed)) {
    if (!value || typeof value !== 'object' || !('TestBundlePath' in value)) {
      continue;
    }
    addTargetValues(value);
  }

  return Array.from(values);
}

function collectXctestrunProductReferenceValuesFromTarget(
  target: Record<string, unknown>,
): string[] {
  const productPathKeys = new Set([
    'ProductPaths',
    'DependentProductPaths',
    'TestHostPath',
    'TestBundlePath',
    'UITargetAppPath',
  ]);
  const values = new Set<string>();
  for (const [key, value] of Object.entries(target)) {
    if (!productPathKeys.has(key)) {
      continue;
    }
    if (typeof value === 'string') {
      values.add(value);
      continue;
    }
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value) {
      if (typeof item === 'string') {
        values.add(item);
      }
    }
  }
  return Array.from(values);
}

function resolveXctestrunProductReferencesFromXml(contents: string): string[] {
  const arrayPathKeys = ['ProductPaths', 'DependentProductPaths'];
  const stringPathKeys = ['TestHostPath', 'TestBundlePath', 'UITargetAppPath'];
  return Array.from(
    new Set([
      ...arrayPathKeys.flatMap((key) => extractPlistArrayStringValues(contents, key)),
      ...stringPathKeys.flatMap((key) => extractPlistStringValues(contents, key)),
    ]),
  );
}

function extractPlistStringValues(contents: string, key: string): string[] {
  const pattern = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`, 'g');
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(contents)) !== null) {
    const value = match[1]?.trim();
    if (value) {
      values.add(value);
    }
  }
  return Array.from(values);
}

function extractPlistArrayStringValues(contents: string, key: string): string[] {
  // Best-effort XML extraction only. Prefer the plutil JSON path on macOS.
  const blockPattern = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`, 'g');
  const stringPattern = /<string>([\s\S]*?)<\/string>/g;
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(contents)) !== null) {
    const block = match[1] ?? '';
    let stringMatch: RegExpExecArray | null;
    while ((stringMatch = stringPattern.exec(block)) !== null) {
      const value = stringMatch[1]?.trim();
      if (value) {
        values.add(value);
      }
    }
  }
  return Array.from(values);
}

function extractAppBundleRoot(relativePath: string): string | null {
  const match = /\.app(?:\/|$)/.exec(relativePath);
  if (!match || match.index === undefined) {
    return null;
  }
  return relativePath.slice(0, match.index + '.app'.length);
}
