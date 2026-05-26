import { handleMcpMessage, type JsonRpcMessage } from './router.ts';

type JsonRpcResponse = Awaited<NonNullable<ReturnType<typeof handleMcpMessage>>>;
type MessageSink = (message: JsonRpcMessage | JsonRpcMessage[]) => void;

export async function runAgentDeviceMcpServer(): Promise<void> {
  const decoder = new McpMessageDecoder((messageOrBatch) => {
    void handleMcpPayload(messageOrBatch)
      .then((response) => {
        if (response) writeMessage(response);
      })
      .catch((error: unknown) => {
        writeMessage({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      });
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
  const responses = (
    await Promise.all(messages.map(async (message) => await handleMcpMessage(message)))
  ).flatMap(responseArray);
  return responses.length > 0 ? responses : null;
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
