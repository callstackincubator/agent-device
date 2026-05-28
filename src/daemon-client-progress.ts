import http from 'node:http';
import { AppError } from './utils/errors.ts';
import type { DaemonRequest } from './daemon/types.ts';
import type { RequestProgressEvent } from './daemon/request-progress.ts';
import { consumeTextLines } from './utils/line-stream.ts';
import {
  formatRequestProgressEvent,
  isDaemonProgressEnvelope,
  isDaemonResponseEnvelope,
  shouldStreamRequestProgress,
} from './daemon/request-progress-protocol.ts';

export function writeRequestProgressEvent(event: RequestProgressEvent): void {
  const line = formatRequestProgressEvent(event);
  if (line) process.stderr.write(`${line}\n`);
}

export function shouldReadDaemonProgressStream(
  req: DaemonRequest,
  contentType: string | string[] | undefined,
): boolean {
  return (
    shouldStreamRequestProgress(req) &&
    String(Array.isArray(contentType) ? contentType.join(',') : (contentType ?? '')).includes(
      'application/x-ndjson',
    )
  );
}

export function readDaemonHttpProgressResponse(
  res: http.IncomingMessage,
  options: {
    req: DaemonRequest;
    handleResponseBody: (body: string) => void;
    reject: (error: unknown) => void;
    clearTimeout: () => void;
  },
): void {
  const { req, handleResponseBody, reject, clearTimeout } = options;
  let buffer = '';
  let settled = false;
  const rejectInvalidLine = (line: string, error: unknown) => {
    settled = true;
    clearTimeout();
    reject(
      new AppError(
        'COMMAND_FAILED',
        'Invalid daemon response',
        {
          requestId: req.meta?.requestId,
          line,
        },
        error instanceof Error ? error : undefined,
      ),
    );
  };

  const handleLine = (line: string): boolean => {
    try {
      const message = JSON.parse(line) as unknown;
      if (isDaemonProgressEnvelope(message)) {
        writeRequestProgressEvent(message.event);
        return false;
      }
      if (isDaemonResponseEnvelope<unknown>(message)) {
        settled = true;
        clearTimeout();
        handleResponseBody(JSON.stringify(message.response));
        return true;
      }
      throw new Error('Missing daemon progress response envelope');
    } catch (error) {
      rejectInvalidLine(line, error);
      return true;
    }
  };

  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    if (settled) return;
    const parsed = consumeTextLines(buffer, chunk);
    buffer = parsed.buffer;
    for (const line of parsed.lines) {
      if (line && handleLine(line)) return;
    }
  });
  res.on('end', () => {
    if (settled) return;
    const line = buffer.trim();
    if (line && handleLine(line)) return;
    settled = true;
    clearTimeout();
    reject(
      new AppError('COMMAND_FAILED', 'Invalid daemon response', {
        requestId: req.meta?.requestId,
        line,
      }),
    );
  });
  res.on('error', (error) => {
    if (settled) return;
    settled = true;
    clearTimeout();
    reject(
      new AppError(
        'COMMAND_FAILED',
        'Failed to read daemon response',
        { requestId: req.meta?.requestId },
        error instanceof Error ? error : undefined,
      ),
    );
  });
}
