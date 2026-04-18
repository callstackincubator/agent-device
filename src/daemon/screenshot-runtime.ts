import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentDeviceBackend, BackendScreenshotResult } from '../backend.ts';
import type { ArtifactAdapter } from '../io.ts';
import { createAgentDevice, localCommandPolicy } from '../runtime.ts';
import { dispatchCommand } from '../core/dispatch.ts';
import { AppError } from '../utils/errors.ts';
import type { DaemonCommandContext } from './context.ts';
import type { SessionState } from './types.ts';

export type ScreenshotOutputPlacement = 'positional' | 'out' | 'default';

export async function dispatchScreenshotViaRuntime(params: {
  session: SessionState;
  sessionName: string;
  outPath?: string;
  outputPlacement: ScreenshotOutputPlacement;
  dispatchContext: DaemonCommandContext;
}): Promise<Record<string, unknown>> {
  const { session, sessionName, outPath, outputPlacement, dispatchContext } = params;
  const runtime = createAgentDevice({
    backend: createDispatchScreenshotBackend({ session, outputPlacement, dispatchContext }),
    artifacts: createDaemonScreenshotArtifactAdapter(),
    sessions: {
      get: (name) =>
        name === sessionName
          ? {
              name: sessionName,
              appBundleId: session.appBundleId,
              metadata: { surface: session.surface },
            }
          : undefined,
      set: () => {},
    },
    policy: localCommandPolicy(),
  });

  return await runtime.capture.screenshot({
    session: sessionName,
    requestId: dispatchContext.requestId,
    appBundleId: session.appBundleId,
    fullscreen: dispatchContext.screenshotFullscreen,
    maxSize: dispatchContext.screenshotMaxSize,
    surface: session.surface,
    ...(outPath ? { out: { kind: 'path', path: outPath } } : {}),
  });
}

function createDispatchScreenshotBackend(params: {
  session: SessionState;
  outputPlacement: ScreenshotOutputPlacement;
  dispatchContext: DaemonCommandContext;
}): AgentDeviceBackend {
  const { session, outputPlacement, dispatchContext } = params;
  return {
    platform: session.device.platform,
    captureScreenshot: async (_context, outPath, options) => {
      const context = {
        ...dispatchContext,
        screenshotFullscreen: options?.fullscreen,
        overlayRefs: options?.overlayRefs,
        surface: options?.surface,
      };
      if (outputPlacement === 'out') {
        return toBackendScreenshotResult(
          await dispatchCommand(session.device, 'screenshot', [], outPath, context),
        );
      }
      return toBackendScreenshotResult(
        await dispatchCommand(session.device, 'screenshot', [outPath], undefined, context),
      );
    },
  };
}

function toBackendScreenshotResult(data: unknown): BackendScreenshotResult | void {
  if (typeof data !== 'object' || data === null) return;
  const record = data as Record<string, unknown>;
  return {
    ...(typeof record.path === 'string' ? { path: record.path } : {}),
    ...(Array.isArray(record.overlayRefs)
      ? { overlayRefs: record.overlayRefs as NonNullable<BackendScreenshotResult['overlayRefs']> }
      : {}),
  };
}

function createDaemonScreenshotArtifactAdapter(): ArtifactAdapter {
  return {
    resolveInput: async () => {
      throw new AppError('UNSUPPORTED_OPERATION', 'screenshot does not resolve input artifacts');
    },
    reserveOutput: async (ref) => {
      let tempRoot: string | undefined;
      let outputPath: string;
      if (ref?.kind === 'path') {
        outputPath = ref.path;
      } else {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-screenshot-'));
        outputPath = path.join(tempRoot, 'screenshot.png');
      }
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      return {
        path: outputPath,
        visibility: 'client-visible',
        publish: async () => undefined,
        ...(tempRoot
          ? {
              cleanup: async () => {
                await fs.rm(tempRoot, { recursive: true, force: true });
              },
            }
          : {}),
      };
    },
    createTempFile: async (options) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `${options.prefix}-`));
      return {
        path: path.join(root, `file${options.ext}`),
        visibility: 'internal',
        cleanup: async () => {
          await fs.rm(root, { recursive: true, force: true });
        },
      };
    },
  };
}
