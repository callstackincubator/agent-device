import { createStatusHandoff, listTools, MCP_SERVER_NAME } from './catalog.ts';
import { readVersion } from '../utils/version.ts';

type JsonRpcId = string | number | null;
const SUPPORTED_PROTOCOL_VERSION = '2025-11-25';

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string } };

export function handleMcpMessage(message: JsonRpcMessage): JsonRpcResponse | null {
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return errorResponse(message.id ?? null, -32600, 'Invalid JSON-RPC request.');
  }
  // Notifications such as notifications/initialized intentionally do not receive responses.
  if (message.id === undefined) return null;

  try {
    return successResponse(message.id, handleRequest(message.method, message.params));
  } catch (error) {
    if (error instanceof JsonRpcMethodNotFoundError) {
      return errorResponse(message.id, -32601, error.message);
    }
    return errorResponse(
      message.id,
      -32602,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function handleRequest(method: string, params: unknown): unknown {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: supportedProtocolVersion(params),
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: readVersion(),
        },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: listTools() };
    case 'tools/call':
      return callTool(params);
    default:
      throw new JsonRpcMethodNotFoundError(`Unsupported MCP method: ${method}`);
  }
}

function callTool(params: unknown): unknown {
  const record = asRecord(params);
  const name = stringField(record, 'name');
  try {
    if (name === 'status') return statusToolResult();
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return textToolResult(error instanceof Error ? error.message : String(error), true);
  }
}

function supportedProtocolVersion(_params: unknown): string {
  return SUPPORTED_PROTOCOL_VERSION;
}

function textToolResult(text: string, isError = false): unknown {
  return {
    isError,
    content: [{ type: 'text', text }],
  };
}

function statusToolResult(): unknown {
  const handoff = createStatusHandoff();
  return {
    isError: false,
    structuredContent: handoff,
    content: [{ type: 'text', text: JSON.stringify(handoff, null, 2) }],
  };
}

function successResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected object parameters.');
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }
  return value;
}

class JsonRpcMethodNotFoundError extends Error {}
