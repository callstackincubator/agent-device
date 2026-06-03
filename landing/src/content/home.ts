import type { PixelIconName } from "@/components/pixel-icon";

export const homeHero = {
  eyebrow: "Interact -> Debug -> Profile -> Capture -> Test E2E",
  title: "The mobile verification for AI Agents.",
  description:
    "Device automation CLI for AI agents. Real apps on iOS, Android, TV, and desktop. Token-efficient snapshots, semantic refs, evidence captured only when needed. Same CLI, local or remote.",
} as const;

export const homeBenefits: Array<{
  icon: PixelIconName;
  title: string;
  body: string;
}> = [
  {
    icon: "run",
    title: "Faster mobile delivery",
    body: "Agent can verify its own work on-device and correct subtle bugs that code-review cannot catch.",
  },
  {
    icon: "coins",
    title: "Higher QA throughput",
    body: "Agent Device can help you scale manual QA process by powering your custom agents with all the tools they need for mobile app verification.",
  },
  {
    icon: "ship",
    title: "Higher release confidence",
    body: "Every PR ships with proof: screenshots, logs, accessibility snapshots, recordings.",
  },
  {
    icon: "box-stack",
    title: "Fits your existing stack",
    body: "Works with your CI, your agents, your release process. No tools to rip out.",
  },
];

export type HomeUseCase = {
  id: string;
  label: string;
  tags: Array<{ icon: PixelIconName; label: string }>;
  title: string;
  body: string;
  rows: Array<{ icon: PixelIconName; text: string }>;
  cta: string;
  href: string;
  demoTitle: string;
  demoSteps: string[];
};

export const homeUseCases: HomeUseCase[] = [
  {
    id: "agentic-quality-assurance",
    label: "AGENTIC QUALITY ASSURANCE",
    tags: [
      { icon: "github", label: "Open Source" },
      { icon: "cloud", label: "Cloud" },
    ],
    title: "Every PR ships with proof.",
    body: "An agent picks up a pull request, checks out the branch, builds the app, installs it, and walks the affected flow. Screenshots, accessibility-tree snapshots, and a written summary post back to the PR. The reviewer sees the work, not the run.",
    rows: [
      {
        icon: "comment-sharp",
        text: "One PR comment per run, with before-and-after evidence",
      },
      {
        icon: "devices",
        text: "iOS and Android driven in parallel from the same workflow",
      },
      {
        icon: "github",
        text: "Triggered automatically by GitHub Actions, EAS, or your own pipeline",
      },
    ],
    cta: "Agentic QA",
    href: "/agentic-qa",
    demoTitle: "PR verification",
    demoSteps: ["checkout branch", "install build", "walk changed flow", "comment evidence"],
  },
  {
    id: "agentic-development",
    label: "AGENTIC DEVELOPMENT",
    tags: [
      { icon: "terminal", label: "Codex" },
      { icon: "braces", label: "Claude Code" },
    ],
    title: "Agents can change mobile UI and verify it themselves.",
    body: "Give your coding agent a real device loop: launch the app, inspect the current screen, tap semantic targets, and capture the result after each change. The agent can iterate on React Native work without asking a human to be the remote control.",
    rows: [
      {
        icon: "terminal",
        text: "Works from local shells, remote workspaces, and agent sandboxes",
      },
      {
        icon: "cursor",
        text: "Semantic selectors make taps resilient across layout shifts",
      },
      {
        icon: "snapshot",
        text: "Snapshots give the agent enough state to decide the next edit",
      },
    ],
    cta: "Agentic Development",
    href: "/agentic-development",
    demoTitle: "Agent edit loop",
    demoSteps: ["inspect screen", "patch component", "rebuild app", "verify result"],
  },
  {
    id: "development-loop",
    label: "DEVELOPMENT LOOP",
    tags: [
      { icon: "device", label: "Local" },
      { icon: "reload", label: "Fast feedback" },
    ],
    title: "Tighten the mobile feedback loop.",
    body: "Run the same checks while developing that your agent will run in CI. Open a simulator or device, drive the feature, capture the UI state, and keep moving without switching into a manual QA rhythm.",
    rows: [
      {
        icon: "reload",
        text: "Repeatable open, interact, snapshot, and close workflow",
      },
      {
        icon: "gauge",
        text: "Profile performance when the UI starts to feel suspicious",
      },
      {
        icon: "video",
        text: "Record the exact moment a local change fixes or breaks the flow",
      },
    ],
    cta: "Start the Loop",
    href: "#toolkit",
    demoTitle: "Local loop",
    demoSteps: ["open app", "exercise flow", "capture proof", "keep coding"],
  },
  {
    id: "migration-verification",
    label: "MIGRATION VERIFICATION",
    tags: [
      { icon: "shuffle", label: "Brownfield" },
      { icon: "check", label: "Regression" },
    ],
    title: "Prove a migration did not move the product backwards.",
    body: "When screens move between native and React Native, agents can compare the critical journeys before and after each step. Capture the behavior, not just screenshots, so migration work stays reviewable.",
    rows: [
      {
        icon: "shuffle",
        text: "Compare old and new flows across iOS and Android targets",
      },
      {
        icon: "check",
        text: "Catch missing states, broken navigation, and accessibility regressions",
      },
      {
        icon: "ship",
        text: "Attach migration evidence to each release or rollout PR",
      },
    ],
    cta: "Verify Migration",
    href: "/agentic-qa",
    demoTitle: "Migration gate",
    demoSteps: ["run old flow", "run new flow", "compare evidence", "approve rollout"],
  },
];
