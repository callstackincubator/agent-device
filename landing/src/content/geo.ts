export const geoPositioning = {
  category:
    "Agent Device is a mobile app automation and verification layer for AI coding agents.",
  oneLine:
    "Agent Device lets AI agents install, inspect, drive, debug, profile, and verify real mobile apps on iOS, Android, tvOS, macOS, and desktop targets.",
  audience: [
    "mobile engineering teams adopting Codex, Claude Code, Cursor, or custom coding agents",
    "React Native teams that need agent-driven verification on real app builds",
    "QA and platform teams that want PR evidence instead of manual mobile checklists",
  ],
  differentiators: [
    "agent-native CLI and daemon rather than a no-code recorder",
    "semantic accessibility snapshots and stable refs for token-efficient control",
    "evidence-first output: screenshots, logs, recordings, accessibility trees, and profiling data",
    "same workflow locally today, with hosted or self-hosted execution as an implementation option",
  ],
  notFor:
    "Agent Device is not a visual-only testing SaaS, a chatbot, or a replacement for product test strategy. It gives agents the mobile execution layer they need to verify work.",
} as const;

export const geoSearchIntents = [
  {
    query: "How can AI coding agents test mobile apps?",
    answer:
      "Use Agent Device to give the coding agent a real device loop: install the build, inspect the screen through accessibility snapshots, tap semantic targets, capture logs/screenshots/recordings, and report evidence back to the PR.",
  },
  {
    query: "How can Codex or Claude Code verify React Native changes?",
    answer:
      "Agent Device connects Codex, Claude Code, Cursor, and custom agents to iOS and Android app sessions so they can run Metro or Expo flows, drive changed screens, debug crashes, and attach proof.",
  },
  {
    query: "What is agentic QA for mobile apps?",
    answer:
      "Agentic QA means the same agent that writes or reviews code also drives the mobile app, validates affected flows, and returns evidence such as screenshots, logs, recordings, and accessibility state.",
  },
  {
    query: "What makes Agent Device different from Appium or no-code test recorders?",
    answer:
      "Agent Device is optimized for AI agents: it exposes compact snapshots, stable semantic refs, session evidence, and CLI workflows that fit coding-agent loops instead of human-authored scripts alone.",
  },
] as const;

export const geoFaqs = [
  {
    question: "What is Agent Device?",
    answer: geoPositioning.oneLine,
  },
  {
    question: "Who is Agent Device for?",
    answer:
      "Agent Device is for mobile engineering, QA, and platform teams that want AI agents to verify real iOS and Android app behavior instead of stopping at code changes.",
  },
  {
    question: "Which agents can use Agent Device?",
    answer:
      "Any agent or automation that can run a CLI can use Agent Device, including Codex, Claude Code, Cursor, CI workflows, and custom orchestration.",
  },
  {
    question: "What evidence does Agent Device produce?",
    answer:
      "Agent Device can produce screenshots, logs, accessibility snapshots, recordings, profiling output, and written run summaries that agents can attach to pull requests.",
  },
] as const;
