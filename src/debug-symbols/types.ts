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

export type AppleImage = {
  index?: number;
  name: string;
  uuid: string;
  arch?: string;
  base: bigint;
  end?: bigint;
  path?: string;
};

export type DsymSlice = {
  dsymPath: string;
  uuid: string;
  arch?: string;
  binaryPath: string;
};

export type SymbolicatedAddress = {
  image: AppleImage;
  address: bigint;
  text?: string;
};

export type IpsDocument = {
  header?: string;
  payload: Record<string, unknown>;
};

export type IpsFrameMatch = SymbolicatedAddress & {
  frame: Record<string, unknown>;
  frameIndex: number;
  threadIndex: number;
};

export type TextFrameMatch = SymbolicatedAddress & {
  frameIndex: number;
  lineIndex: number;
  threadIndex?: number;
};

export type CrashArtifact =
  | {
      format: 'ips';
      images: AppleImage[];
      addresses: SymbolicatedAddress[];
      document: IpsDocument;
      frameMatches: IpsFrameMatch[];
      write: (addressMap: Map<string, SymbolicatedAddress>) => string;
    }
  | {
      format: 'text';
      images: AppleImage[];
      addresses: SymbolicatedAddress[];
      lines: string[];
      frameMatches: TextFrameMatch[];
      write: (addressMap: Map<string, SymbolicatedAddress>) => string;
    };

export type DsymMatch = {
  image: AppleImage;
  dsym: DsymSlice;
};

export type SymbolicationGroup = DsymMatch & {
  addresses: bigint[];
};
