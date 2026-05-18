import { readVersion } from '../utils/version.ts';

export const MCP_SERVER_NAME = 'agent-device';

type StatusHandoff = {
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
  firstCommands: string[];
  automationInterface: 'cli';
  automationNote: string;
  installRequiresHumanApproval: true;
  installSafetyNote: string;
};

export function createStatusHandoff(): StatusHandoff {
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
    firstCommands: [
      'agent-device help workflow',
      'agent-device apps --platform ios',
      'agent-device apps --platform android',
    ],
    automationInterface: 'cli',
    automationNote:
      'Device automation happens through the agent-device CLI. This MCP server is discovery-only and does not expose device automation tools.',
    installRequiresHumanApproval: true,
    installSafetyNote:
      'Agents should not install or update the package unless the human has approved the environment change. If the CLI is missing, ask the human to run the install command, then run the verify command.',
  };
}

export function listTools(): unknown[] {
  return [
    {
      name: 'status',
      description:
        'Return discovery-only handoff metadata for installing, verifying, and using the agent-device CLI.',
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
          firstCommands: {
            type: 'array',
            items: { type: 'string' },
          },
          automationInterface: { type: 'string', const: 'cli' },
          automationNote: { type: 'string' },
          installRequiresHumanApproval: { type: 'boolean', const: true },
          installSafetyNote: { type: 'string' },
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
          'firstCommands',
          'automationInterface',
          'automationNote',
          'installRequiresHumanApproval',
          'installSafetyNote',
        ],
        additionalProperties: false,
      },
    },
  ];
}
