#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [platform, derivedPath, destination] = process.argv.slice(2);

if (!platform || !derivedPath || !destination) {
  console.error('Usage: write-xcuitest-cache-metadata.mjs <ios|macos|tvos> <derived> <destination>');
  process.exit(1);
}

const projectRoot = process.cwd();
const metadataPath = path.join(derivedPath, '.agent-device-runner-cache.json');

const DEFAULT_IOS_RUNNER_APP_BUNDLE_ID = 'com.callstack.agentdevice.runner';

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function normalizeBundleId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveRunnerAppBundleId() {
  return (
    normalizeBundleId(process.env.AGENT_DEVICE_IOS_BUNDLE_ID) ||
    normalizeBundleId(process.env.AGENT_DEVICE_IOS_RUNNER_APP_BUNDLE_ID) ||
    DEFAULT_IOS_RUNNER_APP_BUNDLE_ID
  );
}

function resolveRunnerTestBundleId() {
  return (
    normalizeBundleId(process.env.AGENT_DEVICE_IOS_RUNNER_TEST_BUNDLE_ID) ||
    `${resolveRunnerAppBundleId()}.uitests`
  );
}

function computeRunnerSourceFingerprint() {
  const runnerRoot = path.join(projectRoot, 'ios-runner', 'AgentDeviceRunner');
  const files = collectRunnerSourceFiles(runnerRoot);
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(runnerRoot, file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function collectRunnerSourceFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'xcuserdata') continue;
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && isRunnerSourceFile(entry.name, fullPath)) {
        files.push(fullPath);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function isRunnerSourceFile(fileName, filePath) {
  if (fileName === 'project.pbxproj') {
    return filePath.includes(`${path.sep}.xcodeproj${path.sep}`);
  }
  return [
    '.swift',
    '.plist',
    '.entitlements',
    '.xctestplan',
    '.xcconfig',
    '.storyboard',
    '.xib',
  ].includes(path.extname(fileName));
}

function resolvePlatformName() {
  if (platform === 'ios') return 'iOS';
  if (platform === 'tvos') return 'tvOS';
  if (platform === 'macos') return 'macOS';
  throw new Error(`Unsupported platform: ${platform}`);
}

function resolveDeviceKind() {
  if (platform === 'macos') return 'device';
  return destination.includes('Simulator') ? 'simulator' : 'device';
}

function resolveTarget() {
  if (platform === 'macos') return 'desktop';
  if (platform === 'tvos') return 'tv';
  return 'phone';
}

function resolveMacRunnerArch() {
  return process.arch === 'arm64' ? 'arm64' : 'x86_64';
}

function resolveBuildDestinationFamily() {
  const platformName = resolvePlatformName();
  if (platformName === 'macOS') {
    return `platform=macOS,arch=${resolveMacRunnerArch()}`;
  }
  if (resolveDeviceKind() === 'simulator') {
    return `generic/platform=${platformName} Simulator`;
  }
  return `generic/platform=${platformName}`;
}

function resolveSigningBuildSettings() {
  if (platform !== 'macos') {
    return [];
  }
  return [
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
    'DEVELOPMENT_TEAM=',
  ];
}

const appBundleId = resolveRunnerAppBundleId();
const testBundleId = resolveRunnerTestBundleId();
const metadata = {
  schemaVersion: 1,
  packageVersion: readPackageVersion(),
  runnerSourceFingerprint: computeRunnerSourceFingerprint(),
  platformName: resolvePlatformName(),
  deviceKind: resolveDeviceKind(),
  target: resolveTarget(),
  buildDestinationFamily: resolveBuildDestinationFamily(),
  runnerBundleBuildSettings: [
    `AGENT_DEVICE_IOS_RUNNER_APP_BUNDLE_ID=${appBundleId}`,
    `AGENT_DEVICE_IOS_RUNNER_TEST_BUNDLE_ID=${testBundleId}`,
  ],
  runnerSigningBuildSettings: resolveSigningBuildSettings(),
  runnerPerformanceBuildSettings: ['COMPILER_INDEX_STORE_ENABLE=NO', 'ENABLE_CODE_COVERAGE=NO'],
};

fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
