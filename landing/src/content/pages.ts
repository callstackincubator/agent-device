export type PageStatus = "public" | "preview";

export type PageRegistryEntry = {
  key: "home" | "agenticQa" | "agenticDevelopment";
  path: string;
  title: string;
  label: string;
  description: string;
  ogTitle: string;
  status: PageStatus;
  showInNavigation: boolean;
  llmsSummary: string;
};

export const defaultDescription =
  "Mobile verification for AI agents. Drive real iOS and Android apps, capture proof, and debug mobile flows locally or in CI.";

export const pageRegistry = {
  home: {
    key: "home",
    path: "/",
    title: "Agent Device",
    label: "Home",
    description: defaultDescription,
    ogTitle: "The mobile verification for AI Agents.",
    status: "public",
    showInNavigation: true,
    llmsSummary:
      "Agent Device gives AI agents a mobile verification loop for real iOS and Android apps.",
  },
  agenticQa: {
    key: "agenticQa",
    path: "/agentic-qa",
    title: "Agentic QA",
    label: "Agentic QA",
    description:
      "Manual mobile QA done by AI agents. Agents drive iOS and Android apps, capture proof, and hand evidence back to the PR.",
    ogTitle: "Manual mobile QA, run by AI agents.",
    status: "public",
    showInNavigation: true,
    llmsSummary:
      "Agentic QA uses coding agents to walk mobile flows and attach proof to pull requests.",
  },
  agenticDevelopment: {
    key: "agenticDevelopment",
    path: "/agentic-development",
    title: "Agentic Development",
    label: "Agentic Development",
    description:
      "Agentic mobile development loops that connect code agents to real iOS and Android verification.",
    ogTitle: "Your coding agent, with real mobile reach.",
    status: "public",
    showInNavigation: true,
    llmsSummary:
      "Agentic Development connects code agents to real mobile UI execution, debugging, profiling, and proof capture.",
  },
} satisfies Record<string, PageRegistryEntry>;

export type PageKey = keyof typeof pageRegistry;
export type PageRegistry = typeof pageRegistry;
export type PageEntry = PageRegistry[PageKey];

export const pageEntries = Object.values(pageRegistry);
export const publicPages = pageEntries.filter((page) => page.status === "public");
export const navigationPageEntries = pageEntries.filter(
  (page) => page.status === "public" && page.showInNavigation,
);
