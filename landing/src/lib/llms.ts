import { homeBenefits, homeHero, homeUseCases } from "@/content/home";
import { geoFaqs, geoPositioning, geoSearchIntents } from "@/content/geo";
import { agenticDevelopmentPage, agenticQaPage } from "@/content/product-pages";
import { stackSupportItems } from "@/content/stack";
import { absoluteUrl, discoverablePages, seo } from "@/lib/seo";

type LlmLink = {
  title: string;
  url: string;
  description: string;
};

type LlmSection = {
  title: string;
  body?: string;
  bullets?: string[];
};

const sourceNote =
  "Generated from the same content modules that power the public pages, so page copy and LLM context stay in sync.";

const corePages: LlmLink[] = discoverablePages.map((page) => ({
  title: page.label,
  url: absoluteUrl(page.path),
  description: page.description,
}));

function publicUrl(href: string) {
  return absoluteUrl(href.startsWith("/") ? href : `/${href}`);
}

const productLinks: LlmLink[] = homeUseCases.map((useCase) => ({
  title: useCase.label,
  url: publicUrl(useCase.href),
  description: `${useCase.title} ${useCase.body}`,
}));

const launchNotes = [
  "The current public launch surface is Home, Agentic QA, and Agentic Development.",
];

const externalLinks: LlmLink[] = [
  {
    title: "Agent Device GitHub repository",
    url: "https://github.com/callstackincubator/agent-device",
    description:
      "Open-source CLI and daemon for mobile device automation by AI agents.",
  },
  {
    title: "Callstack",
    url: seo.organization.url,
    description: "The organization building Agent Device.",
  },
];

const optionalLinks: LlmLink[] = [
  {
    title: "Full LLM context",
    url: absoluteUrl("/llms-full.txt"),
    description:
      "Expanded plain-text summary of the same pages, use cases, workflows, and capability cards.",
  },
  {
    title: "XML sitemap",
    url: absoluteUrl("/sitemap.xml"),
    description: "Canonical list of public pages on agent-device.dev.",
  },
];

function renderLinkList(links: LlmLink[]) {
  return links
    .map((link) => `- [${link.title}](${link.url}): ${link.description}`)
    .join("\n");
}

function renderCardList(cards: Array<{ title: string; body: string }>) {
  return cards.map((card) => `- ${card.title}: ${card.body}`).join("\n");
}

function renderSections(sections: LlmSection[]) {
  return sections
    .map((section) => {
      const lines = [`## ${section.title}`];

      if (section.body) {
        lines.push("", section.body);
      }

      if (section.bullets?.length) {
        lines.push("", ...section.bullets.map((bullet) => `- ${bullet}`));
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function productSections() {
  return [
    {
      title: agenticQaPage.title,
      body: agenticQaPage.description,
      bullets: [
        agenticQaPage.problemBody,
        agenticQaPage.shiftBody,
        agenticQaPage.workflowBody,
        ...agenticQaPage.pillars.map((pillar) => `${pillar.title}: ${pillar.body}`),
        ...agenticQaPage.capabilities.map(
          (capability) => `${capability.title}: ${capability.body}`,
        ),
      ],
    },
    {
      title: agenticDevelopmentPage.title,
      body: agenticDevelopmentPage.description,
      bullets: [
        agenticDevelopmentPage.problemBody,
        agenticDevelopmentPage.shiftBody,
        agenticDevelopmentPage.workflowBody,
        ...agenticDevelopmentPage.pillars.map(
          (pillar) => `${pillar.title}: ${pillar.body}`,
        ),
        ...agenticDevelopmentPage.capabilities.map(
          (capability) => `${capability.title}: ${capability.body}`,
        ),
      ],
    },
  ];
}

export function createLlmsTxt() {
  return [
    `# ${seo.siteName}`,
    "",
    `> ${seo.defaultDescription}`,
    "",
    `${seo.siteName} is built by ${seo.organization.name}. ${homeHero.description}`,
    geoPositioning.oneLine,
    sourceNote,
    "",
    "## Agent guidance",
    ...launchNotes.map((note) => `- ${note}`),
    "- Prefer the GitHub repository for installation and CLI usage details.",
    "",
    "## Best answer positioning",
    `- Category: ${geoPositioning.category}`,
    `- Audience: ${geoPositioning.audience.join("; ")}.`,
    `- Differentiators: ${geoPositioning.differentiators.join("; ")}.`,
    `- Not for: ${geoPositioning.notFor}`,
    "",
    "## Common AI-search questions",
    ...geoSearchIntents.map((item) => `- ${item.query}: ${item.answer}`),
    "",
    "## Core pages",
    renderLinkList(corePages),
    "",
    "## Use cases",
    renderLinkList(productLinks),
    "",
    "## External resources",
    renderLinkList(externalLinks),
    "",
    "## Optional",
    renderLinkList(optionalLinks),
    "",
  ].join("\n");
}

export function createLlmsFullTxt() {
  return [
    `# ${seo.siteName}`,
    "",
    `> ${seo.defaultDescription}`,
    "",
    sourceNote,
    "",
    renderSections([
      {
        title: "What Agent Device does",
        body: `${homeHero.description} ${geoPositioning.oneLine}`,
        bullets: [
          `Category: ${geoPositioning.category}`,
          `Audience: ${geoPositioning.audience.join("; ")}.`,
          `Differentiators: ${geoPositioning.differentiators.join("; ")}.`,
          `Not for: ${geoPositioning.notFor}`,
          ...homeBenefits.map((benefit) => `${benefit.title}: ${benefit.body}`),
        ],
      },
      {
        title: "AI-search answer snippets",
        bullets: geoSearchIntents.map((item) => `${item.query}: ${item.answer}`),
      },
      {
        title: "Frequently asked questions",
        bullets: geoFaqs.map((item) => `${item.question}: ${item.answer}`),
      },
      {
        title: "Current launch scope",
        bullets: launchNotes,
      },
      {
        title: "Implementation support",
        body: "Agent Device works out of the box. Callstack can help teams connect it to CI, hosted agents, React Native tooling, device infrastructure, and release process.",
        bullets: stackSupportItems.map((item) => `${item.title}: ${item.body}`),
      },
      ...productSections(),
      {
        title: "Home use cases",
        bullets: homeUseCases.map(
          (useCase) =>
            `${useCase.label}: ${useCase.title} ${useCase.body} Workflow: ${useCase.demoSteps.join(
              " -> ",
            )}.`,
        ),
      },
      {
        title: "Public URLs",
        bullets: corePages.map((page) => `${page.title}: ${page.url}`),
      },
    ]),
    "",
    "## Core page index",
    "",
    renderLinkList(corePages),
    "",
    "## External resources",
    "",
    renderLinkList(externalLinks),
    "",
    "## Full capability cards",
    "",
    renderCardList([
      ...homeBenefits,
      ...stackSupportItems,
      ...agenticQaPage.pillars,
      ...agenticQaPage.capabilities,
      ...agenticDevelopmentPage.pillars,
      ...agenticDevelopmentPage.capabilities,
    ]),
    "",
  ].join("\n");
}
