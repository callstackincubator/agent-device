import type { IconCard } from "@/components/ui/icon-card-grid";

export type ProductPageContent = {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: string;
  secondaryAction: string;
  heroMedia: {
    alt?: string;
    cta?: string;
    src?: string;
    type: "image" | "video-placeholder";
  };
  problemTitle: string;
  problemBody: string;
  stats: {
    value: string;
    label: string;
    body: string;
  }[];
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
  pricing?: {
    title: string;
    body: string;
    plans: {
      name: string;
      price: string;
      detail: string;
      highlighted?: boolean;
    }[];
  };
  stack: {
    title: string;
    body: string;
    items: IconCard[];
  };
  faq: {
    title: string;
    body: string;
    items: { question: string; answer: string }[];
  };
  ctaTitle: string;
  ctaBody: string;
};

export const agenticQaPage: ProductPageContent = {
  eyebrow: "Agentic mobile QA",
  title: "Manual mobile QA, run by AI agents.",
  description:
    "Stop spending engineering hours tapping through builds. Agents drive your iOS and Android apps, capture proof, and hand evidence back to the PR.",
  primaryAction: "Use free template",
  secondaryAction: "Build QA Agent",
  heroMedia: {
    cta: "Watch the QA loop",
    type: "video-placeholder",
  },
  problemTitle: "Agents create more code than ever. Manual QA can't keep up.",
  problemBody:
    "Every new feature multiplies the regression matrix. Every new platform doubles it. The fix has always been more people, more scripts, more Mac fleets. None of that scales.",
  stats: [
    {
      value: "7.2%",
      label: "Drop in delivery stability as AI adoption rises",
      body: "Google Cloud CTO report",
    },
    {
      value: "66%",
      label: "Developers say AI outputs are almost right",
      body: "Stack Overflow Developer Survey",
    },
    {
      value: "48%",
      label: "Always verify AI-assisted code before committing",
      body: "Stack Overflow / Codecademy",
    },
  ],
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
          title: "Agent-native",
          body: "Semantic targeting, mobile semantic refs, evidence bundles, and CI from Linux.",
        },
        {
          icon: "braces",
          title: "Works with your stack",
          body: "Runs alongside your test frameworks, CI providers, and mobile build systems.",
        },
        {
          icon: "shuffle",
          title: "Train-efficient context",
          body: "Gives agents enough mobile state to act without dumping raw screenshots every step.",
        },
        {
          icon: "cloud",
          title: "Works with your stack",
          body: "Use it locally, in CI, or with remote mobile infrastructure when your workflow needs it.",
        },
      ],
    },
  ],
  stack: {
    title: "Make it work in your stack.",
    body: "Agent Device works out of the box. Callstack can help you connect it to CI, hosted agents, React Native tooling, device infrastructure, and release processes.",
    items: [
      {
        icon: "terminal",
        title: "Agent workflows",
        body: "Codex, Claude Code, Cursor, CI, and human handoffs.",
      },
      {
        icon: "braces",
        title: "React Native debugging",
        body: "Metro, native builds, profiling, release logs, and active component reports.",
      },
      {
        icon: "cloud",
        title: "Cloud or self-hosted",
        body: "Managed environments, private infrastructure, internal networks, and custom access policies.",
      },
    ],
  },
  faq: {
    title: "Common questions about Agentic QA",
    body: "Still figuring out where agents fit in your QA process? Start with the workflows your team repeats most.",
    items: [
      {
        question: "Does agentic QA replace our current test stack?",
        answer: "No. It gives agents a way to run the mobile QA loop your team already expects: launch, inspect, act, capture proof, and report back.",
      },
      {
        question: "What QA work should agents handle first?",
        answer: "Start with repetitive PR checks, smoke paths, regression flows, and evidence gathering across iOS and Android.",
      },
    ],
  },
  ctaTitle: "Mobile QA that runs itself.",
  ctaBody:
    "Install the CLI, hand the docs to your agent, and let it walk a flow on your local simulator or device.",
};

export const agenticDevelopmentPage: ProductPageContent = {
  eyebrow: "Agentic mobile development",
  title: "Your coding agent, with real mobile reach.",
  description:
    "Codex, Claude Code, and Cursor work great until they hit mobile. agent-device gives them iOS and Android they can actually drive. Install builds, run dev servers, debug crashes, capture proof.",
  primaryAction: "Get Started",
  secondaryAction: "Get a Demo",
  heroMedia: {
    alt: "Mostly automated app development workflow diagram",
    src: "/figma/agentic-development-hero.webp",
    type: "image",
  },
  problemTitle: "Coding agents stop at the simulator.",
  problemBody:
    "Your agent reads code, writes code, and ships PRs from anywhere. Mobile work still requires the machine with Xcode, the USB-attached phone, and the dev environment a human set up. The agent waits for the human.",
  stats: [
    {
      value: "64%",
      label: "Developers lose time resolving context switching",
      body: "Stack Overflow Labs",
    },
    {
      value: "97%",
      label: "Developers report losing focus due to interruption",
      body: "Qatalog / Cornell University report",
    },
    {
      value: "50K+",
      label: "Developer teams now evaluated using AI tools",
      body: "Google Research",
    },
  ],
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
      eyebrow: "Cloud or local",
      title: "Mobile execution wherever your agents live.",
      body: "Agent Device runs from your machine, CI, or cloud workspaces. Use hosted devices when agents need mobile reach without local hardware.",
      cards: [
        {
          icon: "terminal",
          title: "Local control",
          body: "Drive local simulators, emulators, and attached devices from the agent shell.",
        },
        {
          icon: "cloud",
          title: "Cloud sessions",
          body: "Move the same workflow to remote mobile infrastructure when your agent runs elsewhere.",
        },
      ],
    },
  ],
  stack: {
    title: "Make it work in your stack.",
    body: "Agent Device works out of the box. Callstack can help you connect it to hosted agents, React Native tooling, device infrastructure, and release processes.",
    items: [
      {
        icon: "terminal",
        title: "Agent workflows",
        body: "Codex, Claude Code, Cursor, CI, and human handoffs.",
      },
      {
        icon: "braces",
        title: "React Native debugging",
        body: "Metro, native builds, profiling, release logs, and active component reports.",
      },
      {
        icon: "cloud",
        title: "Cloud or self-hosted",
        body: "Managed environments, private infrastructure, internal networks, and custom access policies.",
      },
    ],
  },
  faq: {
    title: "Common questions about Agentic development",
    body: "Still figuring out how agents fit into mobile engineering? Start with the parts of the loop that still need a remote control.",
    items: [
      {
        question: "Does agentic development replace our current development stack?",
        answer: "No. It gives your coding agents a mobile execution layer so they can run, inspect, debug, and verify apps inside your current workflow.",
      },
      {
        question: "What should agents handle first?",
        answer: "Start with build install checks, smoke paths, crash reproduction, screenshots, recordings, logs, and PR evidence.",
      },
    ],
  },
  ctaTitle: "Your coding agent, with real mobile reach.",
  ctaBody:
    "Request a demo or start locally with the same CLI. Bring mobile verification into the same agent loop that writes the code.",
};
