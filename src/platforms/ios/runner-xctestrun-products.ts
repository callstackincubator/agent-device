import fs from 'node:fs';
import path from 'node:path';
import { runCmdSync } from '../../utils/exec.ts';
import { parseXmlDocumentSync, visitXmlPlistEntries, type XmlNode } from './xml.ts';

const XCTESTRUN_PRODUCT_REFERENCE_KEYS = new Set([
  'ProductPaths',
  'DependentProductPaths',
  'TestHostPath',
  'TestBundlePath',
  'UITargetAppPath',
]);

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
    // On real macOS runner builds, plutil should always be available. If it cannot parse the
    // file here, treat the xctestrun as unusable instead of masking a corrupt plist with a
    // best-effort regex fallback.
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
  const values = new Set<string>();
  for (const [key, value] of Object.entries(target)) {
    if (!XCTESTRUN_PRODUCT_REFERENCE_KEYS.has(key)) {
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
  return collectXctestrunXmlProductReferenceValues(parseXmlDocumentSync(contents));
}

function collectXctestrunXmlProductReferenceValues(nodes: XmlNode[]): string[] {
  const values = new Set<string>();
  visitXmlPlistEntries(nodes, (key, valueNode) => {
    if (!XCTESTRUN_PRODUCT_REFERENCE_KEYS.has(key)) {
      return;
    }
    if (valueNode.name === 'string' && valueNode.text) {
      values.add(valueNode.text);
      return;
    }
    if (valueNode.name !== 'array') {
      return;
    }
    for (const child of valueNode.children) {
      if (child.name === 'string' && child.text) {
        values.add(child.text);
      }
    }
  });
  return Array.from(values);
}

function extractAppBundleRoot(relativePath: string): string | null {
  const match = /\.app(?:\/|$)/.exec(relativePath);
  if (!match || match.index === undefined) {
    return null;
  }
  return relativePath.slice(0, match.index + '.app'.length);
}
