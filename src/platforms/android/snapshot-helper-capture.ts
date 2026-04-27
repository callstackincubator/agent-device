import { AppError } from '../../utils/errors.ts';
import type { SnapshotOptions } from '../../utils/snapshot.ts';
import { parseUiHierarchy } from './ui-hierarchy.ts';
import { ANDROID_SNAPSHOT_MAX_NODES } from './snapshot-types.ts';
import {
  ANDROID_SNAPSHOT_HELPER_COMMAND_OVERHEAD_MS,
  ANDROID_SNAPSHOT_HELPER_OUTPUT_FORMAT,
  ANDROID_SNAPSHOT_HELPER_PACKAGE,
  ANDROID_SNAPSHOT_HELPER_PROTOCOL,
  ANDROID_SNAPSHOT_HELPER_WAIT_FOR_IDLE_TIMEOUT_MS,
} from './snapshot-helper-types.ts';
import type {
  AndroidSnapshotHelperCaptureOptions,
  AndroidSnapshotHelperMetadata,
  AndroidSnapshotHelperOutput,
  AndroidSnapshotHelperParsedSnapshot,
} from './snapshot-helper-types.ts';

type AndroidSnapshotHelperChunk = {
  index: number | undefined;
  count: number | undefined;
  payloadBase64: string;
};

type AndroidInstrumentationRecordState = {
  status: Array<Record<string, string>>;
  results: Array<Record<string, string>>;
  currentStatus: Record<string, string> | null;
  currentResult: Record<string, string> | null;
};

export async function captureAndroidSnapshotWithHelper(
  options: AndroidSnapshotHelperCaptureOptions,
): Promise<AndroidSnapshotHelperOutput> {
  const waitForIdleTimeoutMs =
    options.waitForIdleTimeoutMs ?? ANDROID_SNAPSHOT_HELPER_WAIT_FOR_IDLE_TIMEOUT_MS;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const commandTimeoutMs =
    options.commandTimeoutMs ?? timeoutMs + ANDROID_SNAPSHOT_HELPER_COMMAND_OVERHEAD_MS;
  const maxDepth = options.maxDepth ?? 128;
  const maxNodes = options.maxNodes ?? 5_000;
  const packageName = options.packageName ?? ANDROID_SNAPSHOT_HELPER_PACKAGE;
  const runner = options.instrumentationRunner ?? `${packageName}/.SnapshotInstrumentation`;
  const args = [
    'shell',
    'am',
    'instrument',
    '-w',
    '-e',
    'waitForIdleTimeoutMs',
    String(waitForIdleTimeoutMs),
    '-e',
    'timeoutMs',
    String(timeoutMs),
    '-e',
    'maxDepth',
    String(maxDepth),
    '-e',
    'maxNodes',
    String(maxNodes),
    runner,
  ];

  const result = await options.adb(args, {
    allowFailure: true,
    timeoutMs: commandTimeoutMs,
  });
  let output: AndroidSnapshotHelperOutput;
  try {
    // The helper can report structured ok=false details even when am exits non-zero.
    output = parseAndroidSnapshotHelperOutput(`${result.stdout}\n${result.stderr}`);
  } catch (error) {
    throw new AppError(
      'COMMAND_FAILED',
      result.exitCode === 0
        ? 'Android snapshot helper output could not be parsed'
        : 'Android snapshot helper failed before returning parseable output',
      {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
      error,
    );
  }
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper failed', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      helper: output.metadata,
    });
  }
  return output;
}

export function parseAndroidSnapshotHelperOutput(output: string): AndroidSnapshotHelperOutput {
  const records = parseInstrumentationRecords(output);
  const finalResult = readFinalHelperResult(records.results);
  const xml = decodeHelperXml(collectHelperChunks(records.status), finalResult);

  return {
    xml,
    metadata: readHelperMetadata(finalResult),
  };
}

export function parseAndroidSnapshotHelperXml(
  xml: string,
  metadata: AndroidSnapshotHelperMetadata = {
    outputFormat: ANDROID_SNAPSHOT_HELPER_OUTPUT_FORMAT,
  },
  options: SnapshotOptions = {},
  maxNodes: number = ANDROID_SNAPSHOT_MAX_NODES,
): AndroidSnapshotHelperParsedSnapshot {
  return {
    ...parseUiHierarchy(xml, maxNodes, options),
    metadata,
  };
}

function collectHelperChunks(records: Array<Record<string, string>>): AndroidSnapshotHelperChunk[] {
  return records
    .filter(
      (record) =>
        record.agentDeviceProtocol === ANDROID_SNAPSHOT_HELPER_PROTOCOL &&
        record.outputFormat === ANDROID_SNAPSHOT_HELPER_OUTPUT_FORMAT &&
        typeof record.payloadBase64 === 'string',
    )
    .map((record) => ({
      index: readOptionalNumber(record.chunkIndex),
      count: readOptionalNumber(record.chunkCount),
      payloadBase64: record.payloadBase64,
    }));
}

function readFinalHelperResult(records: Array<Record<string, string>>): Record<string, string> {
  const finalResult = records.find(
    (record) => record.agentDeviceProtocol === ANDROID_SNAPSHOT_HELPER_PROTOCOL,
  );
  if (!finalResult) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper did not return a final result');
  }
  if (finalResult.ok !== 'true') {
    throw new AppError('COMMAND_FAILED', readHelperErrorMessage(finalResult), {
      errorType: finalResult.errorType,
      helper: finalResult,
    });
  }
  return finalResult;
}

function readHelperErrorMessage(finalResult: Record<string, string>): string {
  return finalResult.message && finalResult.message !== 'null'
    ? finalResult.message
    : finalResult.errorType || 'Android snapshot helper returned an error';
}

function decodeHelperXml(
  chunks: AndroidSnapshotHelperChunk[],
  finalResult: Record<string, string>,
): string {
  if (chunks.length === 0) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper did not return XML chunks', {
      helper: finalResult,
    });
  }
  const chunkCount = validateChunkCount(chunks);
  const xml = Buffer.concat(
    readChunkPayloads(indexChunks(chunks, chunkCount), chunkCount),
  ).toString('utf8');
  if (!xml.includes('<hierarchy') || !xml.includes('</hierarchy>')) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper output did not contain XML', {
      xml,
    });
  }
  return xml;
}

function validateChunkCount(chunks: AndroidSnapshotHelperChunk[]): number {
  const chunkCount = chunks[0]?.count ?? chunks.length;
  if (
    chunkCount < 1 ||
    chunks.length !== chunkCount ||
    chunks.some((chunk) => chunk.count !== chunkCount)
  ) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper returned incomplete XML chunks', {
      expectedChunks: chunkCount,
      actualChunks: chunks.length,
    });
  }
  return chunkCount;
}

function indexChunks(
  chunks: AndroidSnapshotHelperChunk[],
  chunkCount: number,
): Map<number, string> {
  const chunksByIndex = new Map<number, string>();
  for (const chunk of chunks) {
    if (chunk.index === undefined || chunk.index < 0 || chunk.index >= chunkCount) {
      throw new AppError('COMMAND_FAILED', 'Android snapshot helper returned invalid chunk index', {
        chunkIndex: chunk.index,
        expectedChunks: chunkCount,
      });
    }
    if (chunksByIndex.has(chunk.index)) {
      throw new AppError(
        'COMMAND_FAILED',
        'Android snapshot helper returned duplicate XML chunks',
        { chunkIndex: chunk.index },
      );
    }
    chunksByIndex.set(chunk.index, chunk.payloadBase64);
  }
  return chunksByIndex;
}

function readChunkPayloads(chunksByIndex: Map<number, string>, chunkCount: number): Buffer[] {
  const payloads: Buffer[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const payloadBase64 = chunksByIndex.get(index);
    if (payloadBase64 === undefined) {
      throw new AppError(
        'COMMAND_FAILED',
        'Android snapshot helper returned incomplete XML chunks',
        {
          missingChunkIndex: index,
          expectedChunks: chunkCount,
        },
      );
    }
    payloads.push(Buffer.from(payloadBase64, 'base64'));
  }
  return payloads;
}

function readHelperMetadata(finalResult: Record<string, string>): AndroidSnapshotHelperMetadata {
  return {
    helperApiVersion: finalResult.helperApiVersion,
    outputFormat: ANDROID_SNAPSHOT_HELPER_OUTPUT_FORMAT,
    waitForIdleTimeoutMs: readOptionalNumber(finalResult.waitForIdleTimeoutMs),
    timeoutMs: readOptionalNumber(finalResult.timeoutMs),
    maxDepth: readOptionalNumber(finalResult.maxDepth),
    maxNodes: readOptionalNumber(finalResult.maxNodes),
    rootPresent: readOptionalBoolean(finalResult.rootPresent),
    captureMode: readOptionalCaptureMode(finalResult.captureMode),
    windowCount: readOptionalNumber(finalResult.windowCount),
    nodeCount: readOptionalNumber(finalResult.nodeCount),
    truncated: readOptionalBoolean(finalResult.truncated),
    elapsedMs: readOptionalNumber(finalResult.elapsedMs),
  };
}

function readOptionalCaptureMode(
  value: string | undefined,
): AndroidSnapshotHelperMetadata['captureMode'] {
  return value === 'interactive-windows' || value === 'active-window' ? value : undefined;
}

function parseInstrumentationRecords(output: string): {
  status: Array<Record<string, string>>;
  results: Array<Record<string, string>>;
} {
  const state: AndroidInstrumentationRecordState = {
    status: [],
    results: [],
    currentStatus: null,
    currentResult: null,
  };

  for (const line of output.split(/\r?\n/)) {
    readInstrumentationRecordLine(line, state);
  }
  flushInstrumentationRecords(state);
  return { status: state.status, results: state.results };
}

function readInstrumentationRecordLine(
  line: string,
  state: AndroidInstrumentationRecordState,
): void {
  if (line.startsWith('INSTRUMENTATION_STATUS: ')) {
    state.currentStatus ??= {};
    readKeyValue(line.slice('INSTRUMENTATION_STATUS: '.length), state.currentStatus);
    return;
  }
  if (line.startsWith('INSTRUMENTATION_STATUS_CODE: ')) {
    flushStatusRecord(state);
    return;
  }
  if (line.startsWith('INSTRUMENTATION_RESULT: ')) {
    state.currentResult ??= {};
    readKeyValue(line.slice('INSTRUMENTATION_RESULT: '.length), state.currentResult);
    return;
  }
  if (line.startsWith('INSTRUMENTATION_CODE: ')) {
    flushResultRecord(state);
  }
}

function flushInstrumentationRecords(state: AndroidInstrumentationRecordState): void {
  flushStatusRecord(state);
  flushResultRecord(state);
}

function flushStatusRecord(state: {
  status: Array<Record<string, string>>;
  currentStatus: Record<string, string> | null;
}): void {
  if (state.currentStatus) {
    state.status.push(state.currentStatus);
    state.currentStatus = null;
  }
}

function flushResultRecord(state: {
  results: Array<Record<string, string>>;
  currentResult: Record<string, string> | null;
}): void {
  if (state.currentResult) {
    state.results.push(state.currentResult);
    state.currentResult = null;
  }
}

function readKeyValue(line: string, target: Record<string, string>): void {
  const separator = line.indexOf('=');
  if (separator < 0) {
    return;
  }
  target[line.slice(0, separator)] = line.slice(separator + 1);
}

function readOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}
