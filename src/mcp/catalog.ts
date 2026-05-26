import { readVersion } from '../utils/version.ts';
import { listSemanticCommandTools } from './semantic-tools.ts';

export const MCP_SERVER_NAME = 'agent-device';

type StatusMetadata = {
  packageName: string;
  installedPackageVersion: string;
  cliCommandName: string;
  installCommand: string;
  verifyCommand: string;
  startingHelpCommand: string;
  supportedTargets: string[];
  capabilities: string[];
  prerequisites: string[];
  docsUrl: string;
  agentDocsUrl: string;
};

export function createStatusMetadata(): StatusMetadata {
  return {
    packageName: 'agent-device',
    installedPackageVersion: readVersion(),
    cliCommandName: 'agent-device',
    installCommand: 'npm install -g agent-device@latest',
    verifyCommand: 'agent-device --version',
    startingHelpCommand: 'agent-device help workflow',
    supportedTargets: [
      'ios-simulator',
      'android-emulator',
      'ios-device',
      'android-device',
      'tvos-simulator',
      'macos',
      'linux',
    ],
    capabilities: [
      'inspect-ui',
      'interact-with-elements',
      'open-apps',
      'install-app',
      'capture-screenshot',
      'accessibility-snapshot',
      'collect-logs',
      'collect-network',
      'collect-performance',
      'record-replay',
      'react-native',
      'expo',
      'android-adb',
      'ios-xcuitest',
    ],
    prerequisites: [
      'node>=22',
      'xcode-for-ios',
      'android-sdk-adb-for-android',
      'macos-accessibility-permission-for-desktop',
    ],
    docsUrl: 'https://agent-device.dev/',
    agentDocsUrl: 'https://incubator.callstack.com/agent-device/llms-full.txt',
  };
}

export function listTools(): unknown[] {
  return [
    {
      name: 'status',
      description:
        'Return package, install, verify, and capability metadata for the agent-device MCP tools.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          packageName: { type: 'string' },
          installedPackageVersion: { type: 'string' },
          cliCommandName: { type: 'string' },
          installCommand: { type: 'string' },
          verifyCommand: { type: 'string' },
          startingHelpCommand: { type: 'string' },
          supportedTargets: {
            type: 'array',
            items: { type: 'string' },
          },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
          },
          prerequisites: {
            type: 'array',
            items: { type: 'string' },
          },
          docsUrl: { type: 'string' },
          agentDocsUrl: { type: 'string' },
        },
        required: [
          'packageName',
          'installedPackageVersion',
          'cliCommandName',
          'installCommand',
          'verifyCommand',
          'startingHelpCommand',
          'supportedTargets',
          'capabilities',
          'prerequisites',
          'docsUrl',
          'agentDocsUrl',
        ],
        additionalProperties: false,
      },
    },
    ...listSemanticCommandTools(),
  ];
}
