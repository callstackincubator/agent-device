import { buildCommandUsageText, buildUsageText } from '../utils/command-schema.ts';
import { readVersion } from '../utils/version.ts';

export const MCP_SERVER_NAME = 'agent-device';
const MCP_REGISTRY_NAME = 'io.github.callstackincubator/agent-device';

const HELP_TOPICS = [
  'workflow',
  'debugging',
  'react-devtools',
  'remote',
  'macos',
  'dogfood',
] as const;

type HelpTopic = (typeof HELP_TOPICS)[number];

type InstallArgs = {
  client?: string;
  global?: boolean;
};

export function createStatusText(): string {
  const status = {
    name: MCP_SERVER_NAME,
    registryName: MCP_REGISTRY_NAME,
    version: readVersion(),
    transport: 'stdio',
    command: 'agent-device mcp',
    node: process.version,
    capabilities: {
      tools: ['status', 'install', 'help'],
      resources: listResources().map((resource) => resource.uri),
      prompts: listPrompts().map((prompt) => prompt.name),
    },
    note: 'This MCP server routes agents to the agent-device CLI. It does not expose device automation or shell execution tools.',
  };
  return JSON.stringify(status, null, 2);
}

export function createInstallText(args: InstallArgs = {}): string {
  const command = args.global === false ? 'npx -y agent-device mcp' : 'agent-device mcp';
  const packageInstall =
    args.global === false ? 'No global install required.' : 'npm install -g agent-device';
  const client = args.client ? `\nClient hint: ${args.client}` : '';
  return `${packageInstall}

MCP server command:
  ${command}

Generic MCP JSON:
  {
    "mcpServers": {
      "agent-device": {
        "command": "${args.global === false ? 'npx' : 'agent-device'}",
        "args": ${JSON.stringify(args.global === false ? ['-y', 'agent-device', 'mcp'] : ['mcp'])}
      }
    }
  }

Use this server for discovery and routing only. For device actions, call the CLI commands returned by the help tool, starting with:
  agent-device help workflow${client}
`;
}

export function createHelpText(args: { topic?: string; command?: string } = {}): string {
  if (args.topic && args.command) {
    throw new Error('Provide either topic or command, not both.');
  }
  const target = args.topic ?? args.command;
  if (!target) return buildUsageText();
  if (args.topic && !isHelpTopic(args.topic)) {
    throw new Error(
      `Unknown help topic: ${args.topic}. Expected one of: ${HELP_TOPICS.join(', ')}`,
    );
  }
  const help = buildCommandUsageText(target);
  if (!help) throw new Error(`Unknown command or help topic: ${target}`);
  return help;
}

export function listTools(): unknown[] {
  return [
    {
      name: 'status',
      description: 'Report the installed agent-device MCP router and CLI metadata.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'install',
      description: 'Return install and MCP client configuration snippets for agent-device.',
      inputSchema: {
        type: 'object',
        properties: {
          client: {
            type: 'string',
            description: 'Optional client name for labeling the returned guidance.',
          },
          global: {
            type: 'boolean',
            description: 'Use a global agent-device binary when true; use npx when false.',
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'help',
      description: 'Return version-matched CLI help for a workflow topic or command.',
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: HELP_TOPICS,
            description: 'Agent workflow topic.',
          },
          command: {
            type: 'string',
            description: 'CLI command name such as snapshot, open, logs, or react-devtools.',
          },
        },
        additionalProperties: false,
      },
    },
  ];
}

export function listResources(): Array<{
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}> {
  return [
    {
      uri: 'agent-device://install',
      name: 'agent-device MCP install',
      description: 'Install and client configuration snippets.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'agent-device://help',
      name: 'agent-device command list',
      description: 'Version-matched command list and global flags.',
      mimeType: 'text/plain',
    },
    ...HELP_TOPICS.map((topic) => ({
      uri: `agent-device://help/${topic}`,
      name: `agent-device help ${topic}`,
      description: `Version-matched ${topic} workflow guidance.`,
      mimeType: 'text/plain',
    })),
  ];
}

export function readResource(uri: string): string {
  if (uri === 'agent-device://install') return createInstallText();
  if (uri === 'agent-device://help') return buildUsageText();
  const topic = uri.startsWith('agent-device://help/')
    ? uri.slice('agent-device://help/'.length)
    : '';
  if (isHelpTopic(topic)) return createHelpText({ topic });
  throw new Error(`Unknown resource: ${uri}`);
}

export function listPrompts(): Array<{ name: string; description: string; arguments: unknown[] }> {
  return [
    createPromptDescriptor('agent-device-workflow', 'Plan a normal app automation loop.'),
    createPromptDescriptor('agent-device-debugging', 'Collect focused debugging evidence.'),
    createPromptDescriptor(
      'agent-device-dogfood',
      'Run exploratory QA with reproducible evidence.',
    ),
    createPromptDescriptor(
      'agent-device-react-native-performance',
      'Inspect React Native renders.',
    ),
    createPromptDescriptor('agent-device-macos', 'Inspect a macOS app or surface.'),
  ];
}

export function getPrompt(name: string, args: Record<string, string> = {}): unknown {
  const topicByPrompt: Record<string, HelpTopic> = {
    'agent-device-workflow': 'workflow',
    'agent-device-debugging': 'debugging',
    'agent-device-dogfood': 'dogfood',
    'agent-device-react-native-performance': 'react-devtools',
    'agent-device-macos': 'macos',
  };
  const topic = topicByPrompt[name];
  if (!topic) throw new Error(`Unknown prompt: ${name}`);
  const target = args.target ? ` Target: ${args.target}.` : '';
  return {
    description: `Use agent-device help ${topic} before planning commands.${target}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Read the agent-device ${topic} guidance through the MCP help tool, then produce a concise command plan using agent-device CLI commands only.${target}`,
        },
      },
    ],
  };
}

function createPromptDescriptor(
  name: string,
  description: string,
): {
  name: string;
  description: string;
  arguments: unknown[];
} {
  return {
    name,
    description,
    arguments: [
      {
        name: 'target',
        description: 'Optional app, device, or task target.',
        required: false,
      },
    ],
  };
}

function isHelpTopic(value: string): value is HelpTopic {
  return (HELP_TOPICS as readonly string[]).includes(value);
}
