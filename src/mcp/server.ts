import { handleMcpMessage, type JsonRpcMessage } from './router.ts';
import type { JsonRpcId } from '../contracts.ts';

type JsonRpcResponse = Awaited<NonNullable<ReturnType<typeof handleMcpMessage>>>;
type MessageSink = (message: JsonRpcMessage | JsonRpcMessage[]) => void;
type PayloadHandler = (
  messageOrBatch: JsonRpcMessage | JsonRpcMessage[],
) => Promise<unknown | null>;
type MessageWriter = (message: unknown) => void;

export async function runAgentDeviceMcpServer(): Promise<void> {
  const payloadQueue = createMcpPayloadQueue();
  const decoder = new McpMessageDecoder((messageOrBatch) => {
    payloadQueue.push(messageOrBatch);
  });

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    try {
      decoder.push(chunk);
    } catch (error) {
      writeMessage({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  await new Promise<void>((resolve) => {
    process.stdin.on('end', resolve);
    process.stdin.on('close', resolve);
    process.stdin.resume();
  });
  await payloadQueue.idle();
}

export function createMcpPayloadQueue(
  options: {
    handlePayload?: PayloadHandler;
    write?: MessageWriter;
  } = {},
): {
  push: (messageOrBatch: JsonRpcMessage | JsonRpcMessage[]) => void;
  idle: () => Promise<void>;
} {
  const handlePayload = options.handlePayload ?? handleMcpPayload;
  const write = options.write ?? writeMessage;
  let pending = Promise.resolve();
  return {
    push: (messageOrBatch) => {
      const fallbackId = fallbackErrorId(messageOrBatch);
      pending = pending
        .then(async () => {
          const response = await handlePayload(messageOrBatch);
          if (response) write(response);
        })
        .catch((error: unknown) => {
          write({
            jsonrpc: '2.0',
            id: fallbackId,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        });
    },
    idle: async () => {
      await pending;
    },
  };
}

export function handleMcpPayload(
  messageOrBatch: JsonRpcMessage | JsonRpcMessage[],
): Promise<unknown | null> {
  if (Array.isArray(messageOrBatch)) {
    return handleMcpBatch(messageOrBatch);
  }
  return handleMcpMessage(messageOrBatch);
}

async function handleMcpBatch(messages: JsonRpcMessage[]): Promise<JsonRpcResponse[] | null> {
  const responses: JsonRpcResponse[] = [];
  for (const message of messages) {
    responses.push(...responseArray(await handleMcpMessage(message)));
  }
  return responses.length > 0 ? responses : null;
}

function fallbackErrorId(messageOrBatch: JsonRpcMessage | JsonRpcMessage[]): JsonRpcId {
  if (Array.isArray(messageOrBatch)) {
    return messageOrBatch.length === 1 ? (messageOrBatch[0]?.id ?? null) : null;
  }
  return messageOrBatch.id ?? null;
}

class McpMessageDecoder {
  private buffer = '';
  private readonly sink: MessageSink;

  constructor(sink: MessageSink) {
    this.sink = sink;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const line = this.tryReadLineMessage();
      if (line !== undefined) {
        this.emit(line);
        continue;
      }
      break;
    }
  }

  private tryReadLineMessage(): string | undefined {
    const newline = this.buffer.indexOf('\n');
    if (newline === -1) return undefined;
    const line = this.buffer.slice(0, newline).trim();
    this.buffer = this.buffer.slice(newline + 1);
    return line.length > 0 ? line : undefined;
  }

  private emit(raw: string): void {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      this.sink(parsed as JsonRpcMessage[]);
      return;
    }
    this.sink(parsed as JsonRpcMessage);
  }
}

function responseArray(response: JsonRpcResponse | null): JsonRpcResponse[] {
  return response ? [response] : [];
}

function writeMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
