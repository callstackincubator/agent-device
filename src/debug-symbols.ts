import fs from 'node:fs/promises';
import path from 'node:path';
import { runCmd } from './utils/exec.ts';
import { AppError } from './utils/errors.ts';

export type DebugSymbolsOptions = {
  action?: 'symbols';
  artifact: string;
  dsym?: string;
  searchPath?: string;
  out?: string;
  cwd?: string;
};

export type DebugSymbolsImage = {
  name: string;
  uuid: string;
  arch?: string;
  dsymPath: string;
  binaryPath: string;
};

export type DebugSymbolsCrashFrame = {
  index: number;
  image: string;
  address: string;
  symbol?: string;
};

export type DebugSymbolsCrashSummary = {
  format: 'ips' | 'text';
  appName?: string;
  bundleId?: string;
  version?: string;
  incident?: string;
  timestamp?: string;
  exceptionType?: string;
  exceptionCodes?: string;
  terminationReason?: string;
  crashedThread?: number;
  topFrames: DebugSymbolsCrashFrame[];
  findings: string[];
};

export type DebugSymbolsResult = {
  kind: 'debugSymbols';
  platform: 'apple';
  artifactPath: string;
  outPath: string;
  crash: DebugSymbolsCrashSummary;
  matchedImages: DebugSymbolsImage[];
  symbolicatedFrames: number;
  skippedImages: number;
  warnings?: string[];
  message: string;
};

type AppleImage = {
  index?: number;
  name: string;
  uuid: string;
  arch?: string;
  base: bigint;
  end?: bigint;
  path?: string;
};

type DsymSlice = {
  dsymPath: string;
  uuid: string;
  arch?: string;
  binaryPath: string;
};

type SymbolicatedAddress = {
  image: AppleImage;
  address: bigint;
  text?: string;
};

type CrashArtifact = {
  images: AppleImage[];
  addresses: SymbolicatedAddress[];
  summary: (addressMap: Map<string, SymbolicatedAddress>) => DebugSymbolsCrashSummary;
  write: (addressMap: Map<string, SymbolicatedAddress>) => string;
};

type IpsFrameMatch = SymbolicatedAddress & {
  frame: Record<string, unknown>;
  frameIndex: number;
  threadIndex: number;
};

type IpsDocument = {
  header?: string;
  payload: Record<string, unknown>;
};

type SymbolicationGroup = {
  image: AppleImage;
  dsym: DsymSlice;
  addresses: bigint[];
};

const MAX_SEARCH_ENTRIES = 10_000;
const MAX_DSYM_CANDIDATES = 200;
const MAX_CRASH_SUMMARY_FRAMES = 5;
const MAX_CRASH_FINDINGS = 3;
const MAX_CRASH_ARTIFACT_BYTES = 64 * 1024 * 1024;
const UUID_DETAIL_SAMPLE_LIMIT = 5;
const UUID_RE = /^[0-9a-fA-F-]{32,36}$/;
const TEXT_IMAGE_ARCH_RE = /^(?:arm64e?|arm64_32|x86_64|armv7[sk]?|i386)$/;

export async function symbolicateCrashArtifact(
  options: DebugSymbolsOptions,
): Promise<DebugSymbolsResult> {
  if (options.action !== undefined && options.action !== 'symbols') {
    throw new AppError('INVALID_ARGS', 'debug supports only the symbols workflow.', {
      hint: 'Use debug symbols --artifact <crash.ips|crash.log> --dsym <App.dSYM> or --search-path <dir> --out <path>.',
    });
  }
  const cwd = options.cwd ?? process.cwd();
  const artifactPath = resolvePath(cwd, options.artifact);
  const outPath = resolvePath(cwd, options.out ?? defaultOutPath(artifactPath));
  const artifactText = await readTextFile(artifactPath, 'crash artifact');
  const crash = readAppleCrashArtifact(artifactText);
  if (!crash) throwUnsupportedArtifact();

  const dsymPaths = await readDsymPaths({
    cwd,
    dsym: options.dsym,
    searchPath: options.searchPath,
  });
  if (dsymPaths.length === 0) {
    throw new AppError('INVALID_ARGS', 'debug symbols requires --dsym or --search-path.', {
      hint: 'Pass a matching .dSYM bundle directly, or pass --search-path <dir> so agent-device can match crash image UUIDs to local dSYMs.',
    });
  }

  const tools = await resolveAppleTools();
  const dsymSlices = await readDsymSlices(dsymPaths, tools.dwarfdump);
  const matched = matchImagesToDsyms(crash.images, dsymSlices, Boolean(options.dsym));
  const addressMap = await symbolicateAddresses(crash.addresses, matched, tools.atos);
  const output = crash.write(addressMap);

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, output, 'utf8');

  const matchedImages = [...matched.values()].map(({ image, dsym }) => ({
    name: image.name,
    uuid: image.uuid,
    arch: image.arch ?? dsym.arch,
    dsymPath: dsym.dsymPath,
    binaryPath: dsym.binaryPath,
  }));
  const symbolicatedFrames = [...addressMap.values()].filter((entry) => entry.text).length;
  const skippedImages = crash.images.length - matchedImages.length;
  const warnings =
    skippedImages > 0
      ? [
          `${skippedImages} Apple image${skippedImages === 1 ? '' : 's'} had no matching dSYM and were left unchanged.`,
        ]
      : undefined;

  return {
    kind: 'debugSymbols',
    platform: 'apple',
    artifactPath,
    outPath,
    crash: crash.summary(addressMap),
    matchedImages,
    symbolicatedFrames,
    skippedImages,
    warnings,
    message: `Symbolicated ${symbolicatedFrames} frame${symbolicatedFrames === 1 ? '' : 's'} -> ${outPath}`,
  };
}

function readAppleCrashArtifact(text: string): CrashArtifact | null {
  return readIpsArtifact(text) ?? readTextCrashArtifact(text);
}

function readIpsArtifact(text: string): CrashArtifact | null {
  const document = readIpsDocument(text);
  if (!document) return null;
  const rawImages = Array.isArray(document.payload.usedImages) ? document.payload.usedImages : [];
  const images = rawImages.flatMap((entry, index) => readIpsImage(entry, index));
  if (images.length === 0) return null;

  const rawThreads = Array.isArray(document.payload.threads) ? document.payload.threads : [];
  const frameMatches = readIpsFrameMatches(rawThreads, images);

  return {
    images,
    addresses: frameMatches.map(({ frame: _frame, ...address }) => address),
    summary: (addressMap) => summarizeIpsCrash(document, frameMatches, addressMap),
    write: (addressMap) => writeIpsArtifact(document, frameMatches, addressMap),
  };
}

function readIpsDocument(text: string): IpsDocument | null {
  const wholeDocument = readJsonRecord(text);
  if (wholeDocument) return { payload: wholeDocument };
  const newlineIndex = text.indexOf('\n');
  if (newlineIndex === -1) return null;
  const header = text.slice(0, newlineIndex);
  const payload = readJsonRecord(text.slice(newlineIndex + 1));
  return payload ? { header, payload } : null;
}

function readJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readIpsFrameMatches(rawThreads: unknown[], images: AppleImage[]): IpsFrameMatch[] {
  const imageByIndex = new Map(images.map((image) => [image.index, image]));
  return rawThreads.flatMap((thread, threadIndex) =>
    readIpsFrameRecords(thread).flatMap((frame, frameIndex) =>
      readIpsFrameMatch(frame, imageByIndex, threadIndex, frameIndex),
    ),
  );
}

function readIpsFrameRecords(thread: unknown): Record<string, unknown>[] {
  if (!thread || typeof thread !== 'object') return [];
  const frames = (thread as Record<string, unknown>).frames;
  return Array.isArray(frames)
    ? frames.filter((frame): frame is Record<string, unknown> => isRecord(frame))
    : [];
}

function readIpsFrameMatch(
  frame: Record<string, unknown>,
  imageByIndex: Map<number | undefined, AppleImage>,
  threadIndex: number,
  frameIndex: number,
): IpsFrameMatch[] {
  const imageIndex = readIntegerNumberField(frame, 'imageIndex', 'IPS frame');
  const imageOffset = readBigIntField(frame, 'imageOffset', 'IPS frame');
  if (imageIndex === undefined || imageOffset === undefined) return [];
  const image = imageByIndex.get(imageIndex);
  return image
    ? [{ frame, frameIndex, threadIndex, image, address: image.base + imageOffset }]
    : [];
}

function writeIpsArtifact(
  document: IpsDocument,
  frameMatches: IpsFrameMatch[],
  addressMap: Map<string, SymbolicatedAddress>,
): string {
  for (const match of frameMatches) {
    const symbol = addressMap.get(addressKey(match.image, match.address))?.text;
    if (symbol) writeIpsFrameSymbol(match.frame, symbol);
  }
  document.payload.agentDeviceSymbolication = {
    tool: 'agent-device debug symbols',
    symbolicatedFrames: [...addressMap.values()].filter((entry) => entry.text).length,
  };
  const payload = `${JSON.stringify(document.payload, null, 2)}\n`;
  return document.header ? `${document.header}\n${payload}` : payload;
}

function writeIpsFrameSymbol(frame: Record<string, unknown>, symbol: string): void {
  const parsed = parseAtosSymbol(symbol);
  frame.symbol = parsed.symbol;
  if (parsed.location !== undefined) frame.symbolLocation = parsed.location;
}

function summarizeIpsCrash(
  document: IpsDocument,
  frameMatches: IpsFrameMatch[],
  addressMap: Map<string, SymbolicatedAddress>,
): DebugSymbolsCrashSummary {
  const crashedThread = readIpsCrashedThread(document.payload);
  const summary: DebugSymbolsCrashSummary = {
    format: 'ips',
    ...readIpsCrashMetadata(document),
    crashedThread,
    topFrames: summarizeIpsFrames(frameMatches, crashedThread, addressMap),
    findings: [],
  };
  return { ...summary, findings: crashFindings(summary) };
}

function readIpsCrashMetadata(
  document: IpsDocument,
): Omit<DebugSymbolsCrashSummary, 'format' | 'crashedThread' | 'topFrames' | 'findings'> {
  const payload = document.payload;
  const header = readIpsHeader(document.header);
  return {
    appName: readIpsAppName(payload, header),
    bundleId: readIpsBundleId(payload, header),
    version: readIpsVersion(payload, header),
    incident: readIpsIncident(payload, header),
    timestamp: readIpsTimestamp(payload, header),
    exceptionType: readIpsExceptionType(payload.exception),
    exceptionCodes: readIpsExceptionCodes(payload.exception),
    terminationReason: readIpsTerminationReason(payload.termination),
  };
}

function readIpsAppName(
  payload: Record<string, unknown>,
  header: Record<string, unknown> | null,
): string | undefined {
  return firstString(payload.procName, header?.app_name, header?.name);
}

function readIpsBundleId(
  payload: Record<string, unknown>,
  header: Record<string, unknown> | null,
): string | undefined {
  return firstString(readRecord(payload.bundleInfo)?.CFBundleIdentifier, header?.bundleID);
}

function readIpsVersion(
  payload: Record<string, unknown>,
  header: Record<string, unknown> | null,
): string | undefined {
  return firstString(
    readRecord(payload.bundleInfo)?.CFBundleShortVersionString,
    header?.app_version,
  );
}

function readIpsIncident(
  payload: Record<string, unknown>,
  header: Record<string, unknown> | null,
): string | undefined {
  return firstString(payload.incident, header?.incident_id);
}

function readIpsTimestamp(
  payload: Record<string, unknown>,
  header: Record<string, unknown> | null,
): string | undefined {
  return firstString(payload.captureTime, header?.timestamp);
}

function readIpsExceptionType(exception: unknown): string | undefined {
  return readString(readRecord(exception)?.type);
}

function readIpsHeader(header: string | undefined): Record<string, unknown> | null {
  return header ? readJsonRecord(header) : null;
}

function readIpsCrashedThread(payload: Record<string, unknown>): number | undefined {
  const faultingThread = readNumber(payload.faultingThread);
  if (faultingThread !== undefined) return faultingThread;
  const threads = Array.isArray(payload.threads) ? payload.threads : [];
  const triggeredIndex = threads.findIndex(
    (thread) => isRecord(thread) && thread.triggered === true,
  );
  return triggeredIndex === -1 ? undefined : triggeredIndex;
}

function readIpsExceptionCodes(exception: unknown): string | undefined {
  const record = readRecord(exception);
  if (!record) return undefined;
  return firstString(record.codes, record.rawCodes);
}

function readIpsTerminationReason(termination: unknown): string | undefined {
  const record = readRecord(termination);
  if (!record) return undefined;
  return compactJoin([
    readString(record.namespace),
    readString(record.code),
    readString(record.reason),
  ]);
}

function summarizeIpsFrames(
  frameMatches: IpsFrameMatch[],
  crashedThread: number | undefined,
  addressMap: Map<string, SymbolicatedAddress>,
): DebugSymbolsCrashFrame[] {
  return frameMatches
    .filter((match) => crashedThread === undefined || match.threadIndex === crashedThread)
    .slice(0, MAX_CRASH_SUMMARY_FRAMES)
    .map((match) => crashFrameSummary(match.frameIndex, match.image, match.address, addressMap));
}

function readIpsImage(value: unknown, index: number): AppleImage[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const uuid = normalizeUuid(readString(record.uuid));
  const base = readBigIntField(record, 'base', 'IPS usedImages');
  if (!uuid || base === undefined) return [];
  const pathValue = readString(record.path);
  return [
    {
      index,
      name: readString(record.name) ?? (pathValue ? path.basename(pathValue) : `image-${index}`),
      uuid,
      arch: readString(record.arch),
      base,
      path: pathValue,
    },
  ];
}

function readTextCrashArtifact(text: string): CrashArtifact | null {
  const lines = text.split('\n');
  const images = readTextImages(lines);
  if (images.length === 0) return null;
  const addresses = readTextFrameAddresses(lines, images);
  return {
    images,
    addresses,
    summary: (addressMap) => summarizeTextCrash(lines, images, addressMap),
    write(addressMap) {
      return lines
        .map((line) => {
          const frame = readTextFrameLine(line, images);
          if (!frame) return line;
          const symbol = addressMap.get(addressKey(frame.image, frame.address))?.text;
          if (!symbol || line.includes(symbol)) return line;
          return `${line}  // ${symbol}`;
        })
        .join('\n');
    },
  };
}

function summarizeTextCrash(
  lines: string[],
  images: AppleImage[],
  addressMap: Map<string, SymbolicatedAddress>,
): DebugSymbolsCrashSummary {
  const crashedThread = readTextCrashedThread(lines);
  const summary: DebugSymbolsCrashSummary = {
    format: 'text',
    appName: readTextProcessName(lines),
    bundleId: readTextField(lines, 'Identifier'),
    version: readTextField(lines, 'Version'),
    incident: readTextField(lines, 'Incident Identifier'),
    timestamp: readTextField(lines, 'Date/Time'),
    exceptionType: readTextField(lines, 'Exception Type'),
    exceptionCodes: readTextField(lines, 'Exception Codes'),
    terminationReason: readTextField(lines, 'Termination Reason'),
    crashedThread,
    topFrames: summarizeTextFrames(lines, images, crashedThread, addressMap),
    findings: [],
  };
  return { ...summary, findings: crashFindings(summary) };
}

function readTextProcessName(lines: string[]): string | undefined {
  const process = readTextField(lines, 'Process');
  return process?.replace(/\s+\[\d+\]$/, '');
}

function readTextField(lines: string[], label: string): string | undefined {
  const prefix = `${label}:`;
  const line = lines.find((candidate) => candidate.trimStart().startsWith(prefix));
  return line ? line.slice(line.indexOf(':') + 1).trim() || undefined : undefined;
}

function readTextCrashedThread(lines: string[]): number | undefined {
  const triggered = readTextField(lines, 'Triggered by Thread');
  const triggeredThread = triggered ? Number.parseInt(triggered, 10) : Number.NaN;
  if (Number.isSafeInteger(triggeredThread)) return triggeredThread;
  for (const line of lines) {
    const match = line.match(/^Thread\s+(\d+)\s+Crashed:/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function summarizeTextFrames(
  lines: string[],
  images: AppleImage[],
  crashedThread: number | undefined,
  addressMap: Map<string, SymbolicatedAddress>,
): DebugSymbolsCrashFrame[] {
  return textCrashedThreadFrameLines(lines, crashedThread)
    .flatMap((line) => readTextCrashFrameSummary(line, images, addressMap))
    .slice(0, MAX_CRASH_SUMMARY_FRAMES);
}

function textCrashedThreadFrameLines(lines: string[], crashedThread: number | undefined): string[] {
  const headingIndex = lines.findIndex((line) =>
    crashedThread === undefined
      ? /^Thread\s+\d+\s+Crashed:/.test(line)
      : new RegExp(`^Thread\\s+${crashedThread}\\s+Crashed:`).test(line),
  );
  if (headingIndex === -1) return [];
  const frames: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (/^Thread\s+\d+/.test(line) || line.trim().length === 0) break;
    if (/^\s*\d+\s+/.test(line)) frames.push(line);
  }
  return frames;
}

function readTextCrashFrameSummary(
  line: string,
  images: AppleImage[],
  addressMap: Map<string, SymbolicatedAddress>,
): DebugSymbolsCrashFrame[] {
  const frame = readTextFrameLine(line, images);
  const indexMatch = line.match(/^\s*(\d+)/);
  return frame && indexMatch
    ? [crashFrameSummary(Number(indexMatch[1]), frame.image, frame.address, addressMap)]
    : [];
}

function crashFrameSummary(
  index: number,
  image: AppleImage,
  address: bigint,
  addressMap: Map<string, SymbolicatedAddress>,
): DebugSymbolsCrashFrame {
  return {
    index,
    image: image.name,
    address: hex(address),
    symbol: addressMap.get(addressKey(image, address))?.text,
  };
}

function crashFindings(summary: DebugSymbolsCrashSummary): string[] {
  return [
    firstSymbolicatedFrameFinding(summary),
    summary.exceptionType ? `Exception: ${summary.exceptionType}` : undefined,
    summary.terminationReason ? `Termination: ${summary.terminationReason}` : undefined,
  ]
    .filter((finding): finding is string => Boolean(finding))
    .slice(0, MAX_CRASH_FINDINGS);
}

function firstSymbolicatedFrameFinding(summary: DebugSymbolsCrashSummary): string | undefined {
  const frame = summary.topFrames.find((candidate) => candidate.symbol);
  if (frame) {
    return `Start with ${frame.symbol} in ${frame.image}; it is the first symbolicated frame captured on the crashed thread.`;
  }
  return summary.topFrames.length > 0
    ? 'No symbolicated frame was found on the crashed thread; verify matching dSYMs for the top images.'
    : undefined;
}

function readTextImages(lines: string[]): AppleImage[] {
  const images: AppleImage[] = [];
  const binaryImagesIndex = lines.findIndex((line) => /^Binary Images:/i.test(line.trim()));
  if (binaryImagesIndex === -1) return images;
  for (const line of lines.slice(binaryImagesIndex + 1)) {
    const image = readTextImageLine(line);
    if (image) images.push(image);
  }
  return images;
}

function readTextImageLine(line: string): AppleImage | null {
  const match = line.match(
    /^\s*(0x[0-9a-fA-F]+)\s*-\s*(0x[0-9a-fA-F]+)\s+\+?(.+?)\s+<([0-9a-fA-F-]{32,36})>\s+(.+)$/,
  );
  if (!match) return null;
  const uuid = normalizeUuid(match[4]);
  if (!uuid) return null;
  const parsedName = readTextImageNameAndArch(match[3]!.trim(), match[5]!.trim());
  return {
    name: parsedName.name,
    arch: parsedName.arch,
    uuid,
    base: BigInt(match[1]!),
    end: BigInt(match[2]!),
    path: match[5]!.trim(),
  };
}

function readTextImageNameAndArch(
  rawName: string,
  imagePath: string,
): { name: string; arch?: string } {
  const tokens = rawName.split(/\s+/);
  const maybeArch = tokens.at(-1);
  if (maybeArch && TEXT_IMAGE_ARCH_RE.test(maybeArch)) {
    return { name: tokens.slice(0, -1).join(' ').trim(), arch: maybeArch };
  }
  const executableName = path.basename(imagePath);
  return { name: rawName.startsWith(executableName) ? executableName : rawName };
}

function readTextFrameAddresses(lines: string[], images: AppleImage[]): SymbolicatedAddress[] {
  return lines.flatMap((line) => {
    const frame = readTextFrameLine(line, images);
    return frame ? [frame] : [];
  });
}

function readTextFrameLine(line: string, images: AppleImage[]): SymbolicatedAddress | null {
  const match = line.match(/^\s*\d+\s+(.+?)\s+(0x[0-9a-fA-F]+)\b/);
  if (!match) return null;
  const imageName = match[1]!.trim();
  const address = BigInt(match[2]!);
  const image = findTextFrameImage(images, imageName, address);
  if (!image) return null;
  return { image, address };
}

function findTextFrameImage(
  images: AppleImage[],
  imageName: string,
  address: bigint,
): AppleImage | undefined {
  const matches = images.filter((candidate) => candidate.name === imageName);
  return matches.find((candidate) => imageContainsAddress(candidate, address)) ?? single(matches);
}

function imageContainsAddress(image: AppleImage, address: bigint): boolean {
  return image.end !== undefined && image.base <= address && address <= image.end;
}

async function readDsymPaths(options: {
  cwd: string;
  dsym?: string;
  searchPath?: string;
}): Promise<string[]> {
  if (options.dsym && options.searchPath) {
    return [
      resolvePath(options.cwd, options.dsym),
      ...(await findDsymBundles(resolvePath(options.cwd, options.searchPath))),
    ];
  }
  if (options.dsym) return [resolvePath(options.cwd, options.dsym)];
  if (options.searchPath)
    return await findDsymBundles(resolvePath(options.cwd, options.searchPath));
  return [];
}

async function findDsymBundles(root: string): Promise<string[]> {
  const found: string[] = [];
  let visited = 0;
  async function walk(current: string): Promise<void> {
    if (found.length >= MAX_DSYM_CANDIDATES) return;
    visited += 1;
    if (visited > MAX_SEARCH_ENTRIES) {
      throw new AppError('COMMAND_FAILED', 'debug symbols search-path scan exceeded bounds.', {
        searchPath: root,
        maxEntries: MAX_SEARCH_ENTRIES,
        hint: 'Pass --dsym <App.dSYM> directly or narrow --search-path to the build products directory.',
      });
    }
    const stat = await readSearchPathStat(current, root);
    if (!stat.isDirectory()) {
      if (current === root) throwInvalidSearchPathDirectory(root);
      return;
    }
    if (current.endsWith('.dSYM')) {
      found.push(current);
      return;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await walk(path.join(current, entry.name));
    }
  }
  await walk(root);
  return found;
}

async function readSearchPathStat(
  current: string,
  root: string,
): Promise<Awaited<ReturnType<typeof fs.stat>>> {
  try {
    return await fs.stat(current);
  } catch {
    throw new AppError('INVALID_ARGS', `debug symbols search path does not exist: ${root}`, {
      hint: 'Pass an existing build products directory to --search-path, or pass --dsym <App.dSYM> directly.',
    });
  }
}

function throwInvalidSearchPathDirectory(root: string): never {
  throw new AppError('INVALID_ARGS', `debug symbols search path is not a directory: ${root}`, {
    hint: 'Pass an existing build products directory to --search-path, or pass --dsym <App.dSYM> directly.',
  });
}

async function readDsymSlices(dsymPaths: string[], dwarfdump: string): Promise<DsymSlice[]> {
  const sliceGroups = await Promise.all(
    unique(dsymPaths).map((dsymPath) => readDsymBundleSlices(dsymPath, dwarfdump)),
  );
  const slices = sliceGroups.flat();
  if (slices.length === 0) {
    throw new AppError('COMMAND_FAILED', 'No UUIDs found in dSYM bundle.', {
      hint: 'Verify the path points to a built .dSYM bundle with DWARF contents.',
    });
  }
  return slices;
}

async function readDsymBundleSlices(dsymPath: string, dwarfdump: string): Promise<DsymSlice[]> {
  await assertDsymBundlePath(dsymPath);
  const result = await runCmd(dwarfdump, ['--uuid', dsymPath], {
    timeoutMs: 15_000,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', `Failed to inspect dSYM UUIDs: ${dsymPath}`, {
      stderr: result.stderr,
      hint: 'Verify the dSYM bundle is valid and readable.',
    });
  }
  return parseDwarfdumpUuidOutput(dsymPath, result.stdout);
}

async function assertDsymBundlePath(dsymPath: string): Promise<void> {
  const stat = await fs.stat(dsymPath).catch(() => null);
  if (stat?.isDirectory() && dsymPath.endsWith('.dSYM')) return;
  throw new AppError('INVALID_ARGS', `Not a .dSYM bundle: ${dsymPath}`, {
    hint: 'Pass the .dSYM bundle path, not the DWARF executable inside it.',
  });
}

function parseDwarfdumpUuidOutput(dsymPath: string, output: string): DsymSlice[] {
  return output.split('\n').flatMap((line) => {
    const match = line.match(/^UUID:\s+([0-9a-fA-F-]{32,36})\s+\(([^)]+)\)\s+(.+)$/);
    const uuid = normalizeUuid(match?.[1]);
    return match && uuid ? [{ dsymPath, uuid, arch: match[2], binaryPath: match[3]!.trim() }] : [];
  });
}

function matchImagesToDsyms(
  images: AppleImage[],
  dsymSlices: DsymSlice[],
  explicitDsym: boolean,
): Map<string, { image: AppleImage; dsym: DsymSlice }> {
  const matched = new Map<string, { image: AppleImage; dsym: DsymSlice }>();
  for (const image of images) {
    const dsym = dsymSlices.find(
      (candidate) =>
        candidate.uuid === image.uuid &&
        (image.arch === undefined || candidate.arch === undefined || candidate.arch === image.arch),
    );
    if (dsym) matched.set(image.uuid, { image, dsym });
  }
  if (matched.size > 0) return matched;

  const artifactUuids = unique(images.map((image) => image.uuid));
  const dsymUuids = unique(dsymSlices.map((slice) => slice.uuid));
  throw new AppError(
    'COMMAND_FAILED',
    explicitDsym
      ? 'dSYM UUID does not match any Apple image in the crash artifact.'
      : 'No matching dSYM UUID found under search path.',
    {
      artifactUuidCount: artifactUuids.length,
      artifactUuidSample: artifactUuids.slice(0, UUID_DETAIL_SAMPLE_LIMIT),
      dsymUuidCount: dsymUuids.length,
      dsymUuidSample: dsymUuids.slice(0, UUID_DETAIL_SAMPLE_LIMIT),
      hint: 'Use dwarfdump --uuid <App.dSYM> and compare it with the crash Binary Images or usedImages UUID, then pass the matching dSYM/search path.',
    },
  );
}

async function symbolicateAddresses(
  addresses: SymbolicatedAddress[],
  matched: Map<string, { image: AppleImage; dsym: DsymSlice }>,
  atos: string,
): Promise<Map<string, SymbolicatedAddress>> {
  const addressMap = new Map<string, SymbolicatedAddress>();
  for (const group of groupSymbolicationAddresses(addresses, matched).values()) {
    for (const entry of await runAtosForGroup(atos, group)) {
      addressMap.set(addressKey(entry.image, entry.address), entry);
    }
  }
  return addressMap;
}

function groupSymbolicationAddresses(
  addresses: SymbolicatedAddress[],
  matched: Map<string, { image: AppleImage; dsym: DsymSlice }>,
): Map<string, SymbolicationGroup> {
  const groups = new Map<string, SymbolicationGroup>();
  for (const frame of addresses) {
    const match = matched.get(frame.image.uuid);
    if (!match) continue;
    const key = `${frame.image.uuid}:${match.dsym.binaryPath}`;
    const group = groups.get(key) ?? { ...match, addresses: [] };
    group.addresses.push(frame.address);
    groups.set(key, group);
  }
  return groups;
}

async function runAtosForGroup(
  atos: string,
  group: SymbolicationGroup,
): Promise<SymbolicatedAddress[]> {
  const addresses = unique(group.addresses.map(hex));
  const result = await runCmd(atos, atosArgs(group, addresses), {
    timeoutMs: 30_000,
    allowFailure: true,
  });
  if (result.exitCode !== 0) throwAtosFailure(result.stderr);
  return mapAtosOutputToAddresses(group.image, addresses, result.stdout);
}

function atosArgs(group: SymbolicationGroup, addresses: string[]): string[] {
  return [
    '-arch',
    group.image.arch ?? group.dsym.arch ?? 'arm64',
    '-o',
    group.dsym.binaryPath,
    '-l',
    hex(group.image.base),
    ...addresses,
  ];
}

function mapAtosOutputToAddresses(
  image: AppleImage,
  addresses: string[],
  output: string,
): SymbolicatedAddress[] {
  const symbols = splitAtosOutput(output);
  return addresses.map((rawAddress, index) => {
    const text = symbols[index]?.trim();
    return {
      image,
      address: BigInt(rawAddress),
      text: isSymbolicatedAtosOutput(text, rawAddress) ? text : undefined,
    };
  });
}

function splitAtosOutput(output: string): string[] {
  const lines = output.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function isSymbolicatedAtosOutput(text: string | undefined, rawAddress: string): text is string {
  if (!text) return false;
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized === '??') return false;
  if (normalized === rawAddress.toLowerCase()) return false;
  return !normalized.startsWith('0x');
}

function throwAtosFailure(stderr: string): never {
  throw new AppError('COMMAND_FAILED', 'atos failed while symbolicating crash frames.', {
    stderr,
    hint: 'Verify the crash artifact and dSYM were produced from the same build and architecture.',
  });
}

async function resolveAppleTools(): Promise<{ dwarfdump: string; atos: string }> {
  return {
    dwarfdump: await resolveAppleTool('dwarfdump'),
    atos: await resolveAppleTool('atos'),
  };
}

async function resolveAppleTool(name: 'dwarfdump' | 'atos'): Promise<string> {
  try {
    const result = await runCmd('xcrun', ['--find', name], {
      timeoutMs: 5_000,
      allowFailure: true,
    });
    const toolPath = result.stdout.trim();
    if (result.exitCode === 0 && toolPath.length > 0) return toolPath;
  } catch {
    // Fall through to the normalized TOOL_MISSING error below.
  }
  throw new AppError('TOOL_MISSING', `Apple symbolication tool not found: ${name}`, {
    hint: 'Install Xcode Command Line Tools and verify xcrun --find dwarfdump and xcrun --find atos succeed.',
  });
}

function parseAtosSymbol(value: string): { symbol: string; location?: number } {
  const match = value.match(/^(.*) \+ (\d+)$/);
  if (!match) return { symbol: value };
  return { symbol: match[1]!, location: Number(match[2]) };
}

function throwUnsupportedArtifact(): never {
  throw new AppError(
    'UNSUPPORTED_OPERATION',
    'debug symbols currently supports Apple crash artifacts with Binary Images or IPS usedImages.',
    {
      hint: 'For Android Java/R8 crashes, use retrace with mapping.txt. For Android native crashes, use ndk-stack or addr2line with unstripped .so symbols. Capture the crash with logs, then symbolicate externally until Android support is added.',
    },
  );
}

async function readTextFile(filePath: string, label: string): Promise<string> {
  await assertTextFileWithinLimit(filePath, label);
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError('INVALID_ARGS', `Failed to read ${label}: ${filePath}`, { message });
  }
}

async function assertTextFileWithinLimit(filePath: string, label: string): Promise<void> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size <= MAX_CRASH_ARTIFACT_BYTES) return;
    throw new AppError('INVALID_ARGS', `${label} is too large: ${filePath}`, {
      actualBytes: stats.size,
      maxBytes: MAX_CRASH_ARTIFACT_BYTES,
      hint: 'Pass a bounded Apple .ips/.crash artifact. For very large logs, first narrow the log to the crash report, or use logs grep/tail for lead-up context.',
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError('INVALID_ARGS', `Failed to read ${label}: ${filePath}`, { message });
  }
}

function resolvePath(cwd: string, value: string): string {
  return path.resolve(cwd, value);
}

function defaultOutPath(artifactPath: string): string {
  const extension = path.extname(artifactPath);
  const base = extension ? artifactPath.slice(0, -extension.length) : artifactPath;
  return `${base}-symbolicated${extension || '.log'}`;
}

function normalizeUuid(value: string | undefined): string | undefined {
  if (!value || !UUID_RE.test(value)) return undefined;
  return value.replaceAll('-', '').toUpperCase();
}

function addressKey(image: AppleImage, address: bigint): string {
  return `${image.uuid}:${hex(address)}`;
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const stringValue = readString(value);
    if (stringValue) return stringValue;
  }
  return undefined;
}

function compactJoin(values: (string | undefined)[]): string | undefined {
  const compact = values.filter((value): value is string => Boolean(value));
  return compact.length > 0 ? compact.join(' ') : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string') {
    const parsed = value.startsWith('0x') ? Number.parseInt(value, 16) : Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readIntegerNumberField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): number | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = readNumber(record[key]);
  if (value !== undefined) return value;
  throwInvalidNumericField(context, key);
}

function readBigIntField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): bigint | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = readBigInt(record[key]);
  if (value !== undefined) return value;
  throwInvalidNumericField(context, key);
}

function readBigInt(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value !== 'string') return undefined;
  if (!/^(?:0x[0-9a-fA-F]+|\d+)$/.test(value)) return undefined;
  return BigInt(value);
}

function throwInvalidNumericField(context: string, key: string): never {
  throw new AppError('INVALID_ARGS', `Invalid ${context} numeric field: ${key}`, {
    hint: 'Crash artifact numeric fields must be integer numbers or integer numeric strings.',
  });
}

function single<T>(values: T[]): T | undefined {
  return values.length === 1 ? values[0] : undefined;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
