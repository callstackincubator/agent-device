import type {
  BackendAlertAction,
  BackendAlertInfo,
  BackendAlertResult,
  BackendDeviceOrientation,
  BackendKeyboardResult,
} from '../backend.ts';
import type { CommandContext } from '../runtime.ts';
import { AppError } from '../utils/errors.ts';
import { successText } from '../utils/success-text.ts';
import { requireIntInRange } from '../utils/validation.ts';
import type { RuntimeCommand } from './index.ts';
import { toBackendContext } from './selector-read-utils.ts';

export type SystemBackCommandOptions = CommandContext & {
  mode?: 'in-app' | 'system';
};

export type SystemBackCommandResult = {
  kind: 'systemBack';
  mode: 'in-app' | 'system';
  backendResult?: Record<string, unknown>;
  message?: string;
};

export type SystemHomeCommandOptions = CommandContext;

export type SystemHomeCommandResult = {
  kind: 'systemHome';
  backendResult?: Record<string, unknown>;
  message?: string;
};

export type SystemRotateCommandOptions = CommandContext & {
  orientation: BackendDeviceOrientation;
};

export type SystemRotateCommandResult = {
  kind: 'systemRotated';
  orientation: BackendDeviceOrientation;
  backendResult?: Record<string, unknown>;
  message?: string;
};

export type SystemKeyboardCommandOptions = CommandContext & {
  action?: 'status' | 'get' | 'dismiss';
};

export type SystemKeyboardCommandResult =
  | {
      kind: 'keyboardState';
      action: 'status' | 'get';
      state: BackendKeyboardResult;
      backendResult?: Record<string, unknown>;
    }
  | {
      kind: 'keyboardDismissed';
      action: 'dismiss';
      state: BackendKeyboardResult;
      backendResult?: Record<string, unknown>;
      message?: string;
    };

export type SystemClipboardCommandOptions =
  | (CommandContext & {
      action: 'read';
    })
  | (CommandContext & {
      action: 'write';
      text: string;
    });

export type SystemClipboardCommandResult =
  | {
      kind: 'clipboardText';
      action: 'read';
      text: string;
    }
  | {
      kind: 'clipboardUpdated';
      action: 'write';
      textLength: number;
      backendResult?: Record<string, unknown>;
      message?: string;
    };

export type SystemSettingsCommandOptions = CommandContext & {
  target?: string;
};

export type SystemSettingsCommandResult = {
  kind: 'settingsOpened';
  target?: string;
  backendResult?: Record<string, unknown>;
  message?: string;
};

export type SystemAlertCommandOptions = CommandContext & {
  action?: BackendAlertAction;
  timeoutMs?: number;
};

export type SystemAlertCommandResult =
  | {
      kind: 'alertStatus';
      action: 'get';
      alert: BackendAlertInfo | null;
    }
  | {
      kind: 'alertHandled';
      action: 'accept' | 'dismiss';
      handled: boolean;
      alert?: BackendAlertInfo;
      button?: string;
      message?: string;
    }
  | {
      kind: 'alertWait';
      action: 'wait';
      alert: BackendAlertInfo | null;
      waitedMs?: number;
      timedOut?: boolean;
      message?: string;
    };

export type SystemAppSwitcherCommandOptions = CommandContext;

export type SystemAppSwitcherCommandResult = {
  kind: 'appSwitcherOpened';
  backendResult?: Record<string, unknown>;
  message?: string;
};

export const backCommand: RuntimeCommand<
  SystemBackCommandOptions | undefined,
  SystemBackCommandResult
> = async (runtime, options = {}): Promise<SystemBackCommandResult> => {
  if (!runtime.backend.pressBack) {
    throw new AppError('UNSUPPORTED_OPERATION', 'system.back is not supported by this backend');
  }
  const mode = options.mode ?? 'in-app';
  if (mode !== 'in-app' && mode !== 'system') {
    throw new AppError('INVALID_ARGS', 'system.back mode must be in-app or system');
  }
  const backendResult = await runtime.backend.pressBack(toBackendContext(runtime, options), {
    mode,
  });
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    kind: 'systemBack',
    mode,
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText('Back'),
  };
};

export const homeCommand: RuntimeCommand<
  SystemHomeCommandOptions | undefined,
  SystemHomeCommandResult
> = async (runtime, options = {}): Promise<SystemHomeCommandResult> => {
  if (!runtime.backend.pressHome) {
    throw new AppError('UNSUPPORTED_OPERATION', 'system.home is not supported by this backend');
  }
  const backendResult = await runtime.backend.pressHome(toBackendContext(runtime, options));
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    kind: 'systemHome',
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText('Home'),
  };
};

export const rotateCommand: RuntimeCommand<
  SystemRotateCommandOptions,
  SystemRotateCommandResult
> = async (runtime, options): Promise<SystemRotateCommandResult> => {
  if (!runtime.backend.rotate) {
    throw new AppError('UNSUPPORTED_OPERATION', 'system.rotate is not supported by this backend');
  }
  const orientation = requireOrientation(options.orientation);
  const backendResult = await runtime.backend.rotate(
    toBackendContext(runtime, options),
    orientation,
  );
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    kind: 'systemRotated',
    orientation,
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText(`Rotated to ${orientation}`),
  };
};

export const keyboardCommand: RuntimeCommand<
  SystemKeyboardCommandOptions | undefined,
  SystemKeyboardCommandResult
> = async (runtime, options = {}): Promise<SystemKeyboardCommandResult> => {
  if (!runtime.backend.setKeyboard) {
    throw new AppError('UNSUPPORTED_OPERATION', 'system.keyboard is not supported by this backend');
  }
  const action = options.action ?? 'status';
  if (action !== 'status' && action !== 'get' && action !== 'dismiss') {
    throw new AppError('INVALID_ARGS', 'system.keyboard action must be status, get, or dismiss');
  }
  const state = await runtime.backend.setKeyboard(toBackendContext(runtime, options), { action });
  const formattedBackendResult = toBackendResult(state);
  if (action === 'dismiss') {
    const dismissed = isKeyboardResult(state) ? state.dismissed : undefined;
    return {
      kind: 'keyboardDismissed',
      action,
      state: isKeyboardResult(state) ? state : {},
      ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
      ...successText(dismissed === false ? 'Keyboard already hidden' : 'Keyboard dismissed'),
    };
  }
  return {
    kind: 'keyboardState',
    action,
    state: isKeyboardResult(state) ? state : {},
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
  };
};

export const clipboardCommand: RuntimeCommand<
  SystemClipboardCommandOptions,
  SystemClipboardCommandResult
> = async (runtime, options): Promise<SystemClipboardCommandResult> => {
  if (options.action === 'read') {
    if (!runtime.backend.getClipboard) {
      throw new AppError(
        'UNSUPPORTED_OPERATION',
        'system.clipboard read is not supported by this backend',
      );
    }
    const result = await runtime.backend.getClipboard(toBackendContext(runtime, options));
    return {
      kind: 'clipboardText',
      action: 'read',
      text: typeof result === 'string' ? result : result.text,
    };
  }

  if (options.action !== 'write') {
    throw new AppError('INVALID_ARGS', 'system.clipboard action must be read or write');
  }
  if (!runtime.backend.setClipboard) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'system.clipboard write is not supported by this backend',
    );
  }
  if (typeof options.text !== 'string') {
    throw new AppError('INVALID_ARGS', 'system.clipboard write requires text');
  }
  const backendResult = await runtime.backend.setClipboard(
    toBackendContext(runtime, options),
    options.text,
  );
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    kind: 'clipboardUpdated',
    action: 'write',
    textLength: Array.from(options.text).length,
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText('Clipboard updated'),
  };
};

export const settingsCommand: RuntimeCommand<
  SystemSettingsCommandOptions | undefined,
  SystemSettingsCommandResult
> = async (runtime, options = {}): Promise<SystemSettingsCommandResult> => {
  if (!runtime.backend.openSettings) {
    throw new AppError('UNSUPPORTED_OPERATION', 'system.settings is not supported by this backend');
  }
  const target = normalizeOptionalText(options.target, 'target');
  const backendResult = await runtime.backend.openSettings(
    toBackendContext(runtime, options),
    target,
  );
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    kind: 'settingsOpened',
    ...(target ? { target } : {}),
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText(target ? `Opened settings: ${target}` : 'Opened settings'),
  };
};

export const alertCommand: RuntimeCommand<
  SystemAlertCommandOptions | undefined,
  SystemAlertCommandResult
> = async (runtime, options = {}): Promise<SystemAlertCommandResult> => {
  if (!runtime.backend.handleAlert) {
    throw new AppError('UNSUPPORTED_OPERATION', 'system.alert is not supported by this backend');
  }
  const action = options.action ?? 'get';
  if (action !== 'get' && action !== 'accept' && action !== 'dismiss' && action !== 'wait') {
    throw new AppError('INVALID_ARGS', 'system.alert action must be get, accept, dismiss, or wait');
  }
  const timeoutMs =
    options.timeoutMs === undefined
      ? undefined
      : requireIntInRange(options.timeoutMs, 'timeoutMs', 0, 120_000);
  const result = await runtime.backend.handleAlert(toBackendContext(runtime, options), action, {
    timeoutMs,
  });
  return normalizeAlertResult(action, result);
};

export const appSwitcherCommand: RuntimeCommand<
  SystemAppSwitcherCommandOptions | undefined,
  SystemAppSwitcherCommandResult
> = async (runtime, options = {}): Promise<SystemAppSwitcherCommandResult> => {
  if (!runtime.backend.openAppSwitcher) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'system.appSwitcher is not supported by this backend',
    );
  }
  const backendResult = await runtime.backend.openAppSwitcher(toBackendContext(runtime, options));
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    kind: 'appSwitcherOpened',
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText('Opened app switcher'),
  };
};

function requireOrientation(orientation: BackendDeviceOrientation): BackendDeviceOrientation {
  switch (orientation) {
    case 'portrait':
    case 'portrait-upside-down':
    case 'landscape-left':
    case 'landscape-right':
      return orientation;
    default:
      throw new AppError(
        'INVALID_ARGS',
        'system.rotate orientation must be portrait, portrait-upside-down, landscape-left, or landscape-right',
      );
  }
}

function normalizeAlertResult(
  action: BackendAlertAction,
  result: BackendAlertResult,
): SystemAlertCommandResult {
  if (action === 'get') {
    if (result.kind !== 'alertStatus') {
      throw new AppError('COMMAND_FAILED', 'system.alert get returned an invalid backend result');
    }
    return { kind: 'alertStatus', action, alert: result.alert };
  }
  if (action === 'wait') {
    if (result.kind !== 'alertWait') {
      throw new AppError('COMMAND_FAILED', 'system.alert wait returned an invalid backend result');
    }
    return {
      kind: 'alertWait',
      action,
      alert: result.alert,
      ...(result.waitedMs !== undefined ? { waitedMs: result.waitedMs } : {}),
      ...(result.timedOut !== undefined ? { timedOut: result.timedOut } : {}),
      ...successText(result.alert ? 'Alert visible' : 'Alert wait timed out'),
    };
  }
  if (result.kind !== 'alertHandled') {
    throw new AppError(
      'COMMAND_FAILED',
      `system.alert ${action} returned an invalid backend result`,
    );
  }
  return {
    kind: 'alertHandled',
    action,
    handled: result.handled,
    ...(result.alert ? { alert: result.alert } : {}),
    ...(result.button ? { button: result.button } : {}),
    ...successText(result.handled ? `Alert ${action}ed` : 'No alert handled'),
  };
}

function normalizeOptionalText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) throw new AppError('INVALID_ARGS', `${field} must be a non-empty string`);
  return text;
}

function isKeyboardResult(value: unknown): value is BackendKeyboardResult {
  return Boolean(value && typeof value === 'object');
}

function toBackendResult(result: unknown): Record<string, unknown> | undefined {
  return result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined;
}
