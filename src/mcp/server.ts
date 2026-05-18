import { readVersion } from '../utils/version.ts';

type JsonRpcId = string | number | null;
type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};
type JsonRpcRequest = { id: JsonRpcId; method: string; params: unknown };

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string } };
type MethodHandler = (params: unknown) => unknown;
type RequestParseResult =
  | { request: JsonRpcRequest; response: null }
  | { request: null; response: JsonRpcResponse | null };

const PROTOCOL_VERSION = '2025-11-25';
const STATUS_TOOL = {
  name: 'status',
  description: 'Report agent-device CLI discovery metadata.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
const METHOD_HANDLERS: Record<string, MethodHandler> = {
  initialize: initializeResult,
  ping: () => ({}),
  'tools/list': () => ({ tools: [STATUS_TOOL] }),
  'tools/call': callTool,
};

export async function runAgentDeviceMcpServer(): Promise<void> {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const response = handleLine(line);
      if (response) writeMessage(response);
    }
  });

  await new Promise<void>((resolve) => {
    process.stdin.on('end', resolve);
    process.stdin.on('close', resolve);
    process.stdin.resume();
  });
}

function handleLine(line: string): JsonRpcResponse | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return handleMessage(JSON.parse(trimmed) as JsonRpcMessage);
  } catch (error) {
    return errorResponse(null, -32700, error instanceof Error ? error.message : String(error));
  }
}

function handleMessage(message: JsonRpcMessage): JsonRpcResponse | null {
  const { request, response } = parseRequest(message);
  return request ? dispatchRequest(request) : response;
}

function parseRequest(message: JsonRpcMessage): RequestParseResult {
  return isJsonRpcRequest(message)
    ? validRequestResult(message)
    : {
        request: null,
        response: errorResponse(message.id ?? null, -32600, 'Invalid JSON-RPC request.'),
      };
}

function isJsonRpcRequest(
  message: JsonRpcMessage,
): message is JsonRpcMessage & { jsonrpc: '2.0'; method: string } {
  return message.jsonrpc === '2.0' && typeof message.method === 'string';
}

function validRequestResult(
  message: JsonRpcMessage & { jsonrpc: '2.0'; method: string },
): RequestParseResult {
  return message.id === undefined
    ? { request: null, response: null }
    : {
        request: { id: message.id, method: message.method, params: message.params },
        response: null,
      };
}

function dispatchRequest(request: JsonRpcRequest): JsonRpcResponse {
  const handler = METHOD_HANDLERS[request.method];
  return handler
    ? successResponse(request.id, handler(request.params))
    : errorResponse(request.id, -32601, `Unsupported MCP method: ${request.method}`);
}

function initializeResult(): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: 'agent-device', version: readVersion() },
  };
}

function callTool(params: unknown): unknown {
  const name = typeof params === 'object' && params ? (params as { name?: unknown }).name : '';
  if (name !== 'status') {
    return textToolResult(`Unknown tool: ${String(name)}`, true);
  }
  return textToolResult(
    JSON.stringify(
      {
        name: 'agent-device',
        version: readVersion(),
        command: 'agent-device',
        note: 'This MCP server is a discovery compatibility stub. Use the agent-device CLI for automation.',
      },
      null,
      2,
    ),
  );
}

function textToolResult(text: string, isError = false): unknown {
  return {
    isError,
    content: [{ type: 'text', text }],
  };
}

function successResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function writeMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
