import type { PixelIconName } from "@/components/pixel-icon";

export const stackSupportItems: Array<{
  icon: PixelIconName;
  title: string;
  body: string;
}> = [
  {
    icon: "run",
    title: "Agent workflows",
    body: "Codex, Claude Code, Cursor, CI, and hosted sandboxes.",
  },
  {
    icon: "gauge",
    title: "React Native debugging",
    body: "Metro, RN DevTools, profiling, reloads, logs, and slow component reports.",
  },
  {
    icon: "devices",
    title: "Remote or self-hosted",
    body: "Private infrastructure, internal networks, and custom device pools when local simulators are not enough.",
  },
];
