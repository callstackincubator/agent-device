import type { AgentDeviceRuntime } from '../../../runtime-contract.ts';
import type { BoundRuntimeCommand, RuntimeCommand } from '../../runtime-types.ts';
import { resolveAppsFilter } from '../app-inventory-contract.ts';
import {
  bootCommand,
  devicesCommand,
  installCommand,
  installFromSourceCommand,
  reinstallCommand,
  shutdownCommand,
  type AdminBootCommandOptions,
  type AdminBootCommandResult,
  type AdminDevicesCommandOptions,
  type AdminDevicesCommandResult,
  type AdminInstallCommandOptions,
  type AdminInstallCommandResult,
  type AdminInstallFromSourceCommandOptions,
  type AdminReinstallCommandOptions,
  type AdminShutdownCommandOptions,
  type AdminShutdownCommandResult,
} from './admin.ts';
import {
  closeAppCommand,
  getAppStateCommand,
  listAppsCommand,
  openAppCommand,
  pushAppCommand,
  triggerAppEventCommand,
  type CloseAppCommandOptions,
  type CloseAppCommandResult,
  type GetAppStateCommandOptions,
  type GetAppStateCommandResult,
  type ListAppsCommandOptions,
  type ListAppsCommandResult,
  type OpenAppCommandOptions,
  type OpenAppCommandResult,
  type PushAppCommandOptions,
  type PushAppCommandResult,
  type TriggerAppEventCommandOptions,
  type TriggerAppEventCommandResult,
} from './apps.ts';

export type AppCommands = {
  open: RuntimeCommand<OpenAppCommandOptions, OpenAppCommandResult>;
  close: RuntimeCommand<CloseAppCommandOptions | undefined, CloseAppCommandResult>;
  list: RuntimeCommand<ListAppsCommandOptions | undefined, ListAppsCommandResult>;
  state: RuntimeCommand<GetAppStateCommandOptions, GetAppStateCommandResult>;
  push: RuntimeCommand<PushAppCommandOptions, PushAppCommandResult>;
  triggerEvent: RuntimeCommand<TriggerAppEventCommandOptions, TriggerAppEventCommandResult>;
};

export type AdminCommands = {
  devices: RuntimeCommand<AdminDevicesCommandOptions | undefined, AdminDevicesCommandResult>;
  boot: RuntimeCommand<AdminBootCommandOptions | undefined, AdminBootCommandResult>;
  shutdown: RuntimeCommand<AdminShutdownCommandOptions | undefined, AdminShutdownCommandResult>;
  install: RuntimeCommand<AdminInstallCommandOptions, AdminInstallCommandResult>;
  reinstall: RuntimeCommand<AdminReinstallCommandOptions, AdminInstallCommandResult>;
  installFromSource: RuntimeCommand<
    AdminInstallFromSourceCommandOptions,
    AdminInstallCommandResult
  >;
};

export type BoundAppCommands = {
  open: BoundRuntimeCommand<OpenAppCommandOptions, OpenAppCommandResult>;
  close: (options?: CloseAppCommandOptions) => Promise<CloseAppCommandResult>;
  list: (options?: ListAppsCommandOptions) => Promise<ListAppsCommandResult>;
  state: BoundRuntimeCommand<GetAppStateCommandOptions, GetAppStateCommandResult>;
  push: BoundRuntimeCommand<PushAppCommandOptions, PushAppCommandResult>;
  triggerEvent: BoundRuntimeCommand<TriggerAppEventCommandOptions, TriggerAppEventCommandResult>;
};

export type BoundAdminCommands = {
  devices: (options?: AdminDevicesCommandOptions) => Promise<AdminDevicesCommandResult>;
  boot: (options?: AdminBootCommandOptions) => Promise<AdminBootCommandResult>;
  shutdown: (options?: AdminShutdownCommandOptions) => Promise<AdminShutdownCommandResult>;
  install: BoundRuntimeCommand<AdminInstallCommandOptions, AdminInstallCommandResult>;
  reinstall: BoundRuntimeCommand<AdminReinstallCommandOptions, AdminInstallCommandResult>;
  installFromSource: BoundRuntimeCommand<
    AdminInstallFromSourceCommandOptions,
    AdminInstallCommandResult
  >;
};

export const appCommands: AppCommands = {
  open: openAppCommand,
  close: closeAppCommand,
  list: listAppsCommand,
  state: getAppStateCommand,
  push: pushAppCommand,
  triggerEvent: triggerAppEventCommand,
};

export const adminCommands: AdminCommands = {
  devices: devicesCommand,
  boot: bootCommand,
  shutdown: shutdownCommand,
  install: installCommand,
  reinstall: reinstallCommand,
  installFromSource: installFromSourceCommand,
};

export function bindAppCommands(runtime: AgentDeviceRuntime): BoundAppCommands {
  return {
    open: (options) => appCommands.open(runtime, options),
    close: (options) => appCommands.close(runtime, options),
    list: (options = {}) =>
      appCommands.list(runtime, {
        ...options,
        filter: resolveAppsFilter(options.filter),
      }),
    state: (options) => appCommands.state(runtime, options),
    push: (options) => appCommands.push(runtime, options),
    triggerEvent: (options) => appCommands.triggerEvent(runtime, options),
  };
}

export function bindAdminCommands(runtime: AgentDeviceRuntime): BoundAdminCommands {
  return {
    devices: (options) => adminCommands.devices(runtime, options),
    boot: (options) => adminCommands.boot(runtime, options),
    shutdown: (options) => adminCommands.shutdown(runtime, options),
    install: (options) => adminCommands.install(runtime, options),
    reinstall: (options) => adminCommands.reinstall(runtime, options),
    installFromSource: (options) => adminCommands.installFromSource(runtime, options),
  };
}
