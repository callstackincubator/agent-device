import type { IconCard } from "@/components/ui/icon-card-grid";

export type ProductPageContent = {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: string;
  secondaryAction: string;
  problemTitle: string;
  problemBody: string;
  shiftTitle: string;
  shiftBody: string;
  pillars: IconCard[];
  workflowTitle: string;
  workflowBody: string;
  workflowSteps: string[];
  capabilitiesTitle: string;
  capabilitiesBody: string;
  capabilities: IconCard[];
  supportSections: {
    eyebrow: string;
    title: string;
    body: string;
    cards?: IconCard[];
    previewOnly?: boolean;
  }[];
  ctaTitle: string;
  ctaBody: string;
};

export const agenticQaPage: ProductPageContent = {
  eyebrow: "Agentic mobile QA",
  title: "Manual QA done by AI Agents, on your terms.",
  description:
    "Stop spending engineering hours tapping through builds. Agents drive your iOS and Android apps, capture proof, and hand evidence back to the PR.",
  primaryAction: "Use free template",
  secondaryAction: "Build QA Agent",
  problemTitle: "Agents create more code than ever. Manual QA can't keep up.",
  problemBody:
    "Every new feature multiplies the regression matrix. Every new platform doubles it. The fix has always been more people, more scripts, more Mac fleets. None of that scales.",
  shiftTitle: "The QA loop, automated by the agents you already use.",
  shiftBody:
    "Agentic QA is mobile testing driven by coding agents: Claude Code, Codex, Cursor. Not a separate QA platform. Not a no-code recorder. Same agent, same protocol, real devices.",
  pillars: [
    {
      icon: "terminal",
      title: "Agent-driven",
      body: "Your existing AI agents run the QA loop. No new framework to learn.",
    },
    {
      icon: "bookmark-check",
      title: "Evidence-first",
      body: "Every run produces screenshots, recordings, accessibility trees, and logs the agent can attach to a PR.",
    },
    {
      icon: "devices",
      title: "Real devices",
      body: "Local sims or remote iOS and Android sessions. Same workflow either way.",
    },
  ],
  workflowTitle: "From PR open to QA evidence in one run.",
  workflowBody:
    "One pull request triggers the full QA loop. The agent picks it up, builds the app, walks the affected flow on iOS and Android in parallel, and posts proof back to the PR.",
  workflowSteps: [
    "PR open",
    "Agent picks up",
    "Install build",
    "Walk flow",
    "Capture evidence",
    "Post to PR",
  ],
  capabilitiesTitle: "The work agents take off your plate.",
  capabilitiesBody:
    "Not every test should be agent-driven. The ones that should are repetitive, evidence-heavy, or span platforms. That's where agentic QA earns its keep.",
  capabilities: [
    {
      icon: "reload",
      title: "Regression flows",
      body: "The same paths, every PR, on every platform. Without a person watching.",
    },
    {
      icon: "snapshot",
      title: "Visual regression",
      body: "Screen-by-screen diffs against a baseline. Surfaces unintended UI changes.",
    },
    {
      icon: "accessibility",
      title: "Accessibility audits",
      body: "Structured accessibility tree captured on every run. Compliance becomes evidence.",
    },
    {
      icon: "check",
      title: "Smoke tests",
      body: "Critical paths verified before merge. No build ships without proof.",
    },
  ],
  supportSections: [
    {
      eyebrow: "Comparison",
      title: "Where agentic QA fits in your current tooling.",
      body: "Most teams already have something: Detox, Maestro, BrowserStack, manual QA, or some mix. agent-device is not a replacement framework. It is the layer that makes any of those usable by an agent.",
      cards: [
        {
          icon: "terminal",
          title: "agent-device",
          body: "Agent-native, semantic targeting, real devices, evidence bundles, CI from Linux, no vendor lock-in.",
        },
        {
          icon: "braces",
          title: "Detox and Maestro",
          body: "Great test frameworks. Agent Device gives coding agents a way to drive and collect evidence around them.",
        },
        {
          icon: "phone",
          title: "Device infrastructure",
          body: "Useful infrastructure. Agent Device adds the agent protocol and evidence shape.",
        },
        {
          icon: "hand",
          title: "Manual QA",
          body: "Still useful for judgment. Agents take repetitive proof-heavy loops off the queue.",
        },
      ],
    },
  ],
  ctaTitle: "Mobile QA that runs itself.",
  ctaBody:
    "Install the CLI, hand the docs to your agent, and let it walk a flow on your local simulator or device.",
};

export const agenticDevelopmentPage: ProductPageContent = {
  eyebrow: "Agentic mobile development",
  title: "Your coding agent, with real mobile reach.",
  description:
    "Codex, Claude Code, and Cursor work great until they hit mobile. agent-device gives them iOS and Android they can actually drive: install builds, run dev servers, debug crashes, capture proof.",
  primaryAction: "Get Started",
  secondaryAction: "Get a Demo",
  problemTitle: "Coding agents stop at the simulator.",
  problemBody:
    "Your agent reads code, writes code, and ships PRs from anywhere. Mobile work still requires the machine with Xcode, the USB-attached phone, and the dev environment a human set up. The agent waits for the human.",
  shiftTitle: "Mobile development the agent can drive end to end.",
  shiftBody:
    "Not a code-completion plugin. Not a chatbot wrapper. agent-device is the execution layer that lets agents install builds, run Metro, drive the UI, debug crashes, and profile performance.",
  pillars: [
    {
      icon: "devices",
      title: "Real devices",
      body: "iOS and Android, simulators or hardware, local or remote.",
    },
    {
      icon: "reload",
      title: "Full dev loop",
      body: "Metro, Expo tunnel, fast refresh, log capture, crash repros.",
    },
    {
      icon: "terminal",
      title: "Agent-native",
      body: "Designed for the way Codex, Claude Code, and Cursor actually run.",
    },
  ],
  workflowTitle: "From feature request to working build, agent-driven.",
  workflowBody:
    "A developer or another agent hands the coding agent a feature. The agent writes the code, installs the build, runs it on a real device, drives the new flow, captures evidence, and either ships the PR or reports back with what broke.",
  workflowSteps: ["Feature request", "Code", "Install", "Run", "Drive", "Capture", "Ship"],
  capabilitiesTitle: "The mobile work agents take over.",
  capabilitiesBody:
    "Give agents the mobile side of the loop so they can move from implementation to verified behavior without waiting on a human remote control.",
  capabilities: [
    {
      icon: "download",
      title: "Build and install",
      body: "From any code change, on any device.",
    },
    {
      icon: "list",
      title: "Run and debug",
      body: "Metro, Expo tunnel, log capture, crash repros.",
    },
    {
      icon: "cursor",
      title: "Drive and verify",
      body: "Semantic UI control with stable refs that survive layout changes.",
    },
    {
      icon: "gauge",
      title: "Profile and prove",
      body: "Performance metrics and evidence bundles attached to the PR.",
    },
  ],
  supportSections: [
    {
      eyebrow: "Agentic mobile QA",
      title: "Manual QA done by AI Agents, on your terms.",
      body: "Agents drive your iOS and Android apps, capture proof, and hand evidence back to the PR.",
    },
  ],
  ctaTitle: "Your coding agent, with real mobile reach.",
  ctaBody:
    "Request a demo or start locally with the same CLI. Bring mobile verification into the same agent loop that writes the code.",
};
