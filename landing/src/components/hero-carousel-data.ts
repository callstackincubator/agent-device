import type { PixelIconName } from "@/components/pixel-icon";

export type HeroCarouselCardStatus = "done" | "pending" | "error";

export type HeroCarouselCardData = {
  id: string;
  eyebrow: string;
  title: string;
  icon: PixelIconName;
  status: HeroCarouselCardStatus;
  action?: {
    href: string;
    label: string;
  };
  rows: Array<{
    icon: PixelIconName;
    label: string;
    value: string;
  }>;
};

export const heroCarouselCards: HeroCarouselCardData[] = [
  {
    id: "gateway",
    eyebrow: "01 Gateway",
    title: "Task intake",
    icon: "run",
    status: "pending",
    action: { href: "#get-started", label: "Start agent run" },
    rows: [
      { icon: "comment", label: "Prompt", value: "Implement feature #2137" },
      { icon: "gauge", label: "Mode", value: "Make no mistakes" },
      { icon: "check", label: "Verify", value: "Required" },
      { icon: "device", label: "Target", value: "iOS Simulator" },
    ],
  },
  {
    id: "code-agent-implementation",
    eyebrow: "02 Code Agent",
    title: "Implementation",
    icon: "braces",
    status: "done",
    rows: [
      { icon: "shuffle", label: "Branch", value: "feature/2137" },
      { icon: "list", label: "Files modified", value: "4" },
      { icon: "check", label: "Tests updated", value: "2" },
      {
        icon: "bookmark-check",
        label: "Skill",
        value: "React Native best practices",
      },
    ],
  },
  {
    id: "reviewer",
    eyebrow: "03 Reviewer",
    title: "Self review",
    icon: "search",
    status: "pending",
    rows: [
      { icon: "list", label: "Changes", value: "4 files modified" },
      { icon: "search", label: "Issues found", value: "1" },
      { icon: "clock", label: "Status", value: "Needs mobile check" },
      { icon: "gauge", label: "Risk", value: "Feature X flow" },
    ],
  },
  {
    id: "agent-device-mobile",
    eyebrow: "04 Agent Device",
    title: "Mobile execution",
    icon: "device",
    status: "error",
    action: { href: "#capture", label: "Watch recording 00:42" },
    rows: [
      { icon: "snapshot", label: "Snapshot", value: "Captured" },
      { icon: "cursor", label: "Action", value: "Swipe + tap" },
      { icon: "video", label: "Recording", value: "Saved" },
      { icon: "list", label: "Result", value: "Crash found" },
    ],
  },
  {
    id: "agent-device-debug",
    eyebrow: "05 Agent Device",
    title: "Debug output",
    icon: "terminal",
    status: "error",
    rows: [
      { icon: "list", label: "Logs", value: "Last 200 lines" },
      { icon: "terminal", label: "Trace", value: "Captured" },
      { icon: "download", label: "Device state", value: "Saved" },
      { icon: "gauge", label: "Error", value: "Out of memory" },
    ],
  },
  {
    id: "code-agent-remediation",
    eyebrow: "06 Code Agent",
    title: "Remediation",
    icon: "braces",
    status: "done",
    action: { href: "#get-started", label: "Open pull request" },
    rows: [
      { icon: "check", label: "Fix", value: "Limit image cache" },
      { icon: "list", label: "Files modified", value: "1" },
      { icon: "bookmark-check", label: "Tests", value: "Passed" },
      { icon: "github", label: "PR", value: "Ready for review" },
    ],
  },
];
