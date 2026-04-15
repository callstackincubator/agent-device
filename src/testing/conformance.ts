import type { AgentDeviceRuntime } from '../runtime.ts';

export type ConformanceRuntimeFactory = () => AgentDeviceRuntime | Promise<AgentDeviceRuntime>;

export type CommandConformanceTarget = {
  name: string;
  createRuntime: ConformanceRuntimeFactory;
};

export type CommandConformanceSuite = {
  name: string;
  run(target: CommandConformanceTarget): Promise<void>;
};

export const commandConformanceSuites: readonly CommandConformanceSuite[] = [];
