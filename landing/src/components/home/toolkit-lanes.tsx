import Image from "next/image";

import { PixelIcon, type PixelIconName } from "@/components/pixel-icon";
import { PromptCopyButton } from "@/components/prompt-copy-button";
import { SectionShell } from "@/components/section-shell";
import { ToolkitSectionNav } from "@/components/toolkit-section-nav";
import { BodyText } from "@/components/ui/typography";

type Lane = {
  id: string;
  step: string;
  title: string;
  body: string;
  bullets: string[];
  prompt: string;
  image: string;
  icons: [PixelIconName, PixelIconName, PixelIconName];
};

const laneImage = {
  displayWidth: 528,
  displayHeight: 868,
  intrinsicWidth: 2112,
  intrinsicHeight: 3472,
} as const;

const lanes: Lane[] = [
  {
    id: "interact",
    step: "01. Interact",
    title: "Drive the UI with semantic targets.",
    body: "Drive a mobile UI through text and intent. The agent sees a structured tree of what is on screen and chooses targets the way a person would, by what they say. Flows survive redesigns, copy changes, and layout shifts.",
    bullets: [
      "Semantic targeting by text, label, or role",
      "Stable refs that survive layout changes",
      "Full parity: tap, type, scroll, swipe, longpress",
    ],
    prompt:
      "Using agent-device, sign in with the test account, scroll to the third feed item, and tap the like button.",
    image: "/figma/lane-interact.webp",
    icons: ["box-stack", "reload", "hand"],
  },
  {
    id: "debug",
    step: "02. Debug",
    title: "Crash repros with full context.",
    body: "When a flow fails, Agent Device captures the state an engineer needs: logs, screen recording, screenshots, and the last actions that led there.",
    bullets: [
      "Daemon and app logs bundled with failures",
      "Crash stack traces with device and build metadata",
      "Artifacts attached only when they matter",
    ],
    prompt: "Debug why checkout_payment freezes for user Tina on iOS simulator.",
    image: "/figma/lane-debug.webp",
    icons: ["terminal", "list", "video"],
  },
  {
    id: "profile",
    step: "03. Profile",
    title: "CPU, memory, FPS when it matters.",
    body: "Performance regressions are hard to review in code. Agent Device can profile real sessions and preserve compact evidence for follow-up.",
    bullets: [
      "CPU, memory, FPS snapshots",
      "Trace bad frames with input context",
      "Trend evidence across builds and devices",
    ],
    prompt: "Find why search feels slow on Pixel 9 after opening five result cards.",
    image: "/figma/lane-profile.webp",
    icons: ["gauge", "terminal", "list"],
  },
  {
    id: "capture",
    step: "04. Capture",
    title: "Evidence the agent can hand back.",
    body: "Reviewers need proof, not a wall of tool logs. Capture screenshots, accessibility trees, and recordings so each run ends with evidence humans can inspect.",
    bullets: [
      "Accessibility tree and visual state",
      "Screenshots at important checkpoints",
      "Recordings for hard-to-explain failures",
    ],
    prompt: "Capture the onboarding success screen with accessibility details.",
    image: "/figma/lane-capture.webp",
    icons: ["accessibility", "video", "snapshot"],
  },
  {
    id: "test-e2e",
    step: "05. Test E2E",
    title: "Turn agent runs into deterministic tests.",
    body: "Once an agent has found the right path, Agent Device can replay and stabilize the flow so verification keeps running after the PR lands.",
    bullets: [
      "Replay successful flows from recordings",
      "Use stable semantic selectors",
      "Run the same checks locally and in CI",
    ],
    prompt: "Replay signup, checkout, and invite flows on iOS and Android.",
    image: "/figma/lane-test.webp",
    icons: ["reload", "box-stack", "terminal"],
  },
];

export function ToolkitLanes() {
  return (
    <SectionShell id="toolkit">
      <div className="mx-auto max-w-[1312px]">
        <div className="max-w-[420px]">
          <p className="font-mono text-xs font-medium uppercase leading-5 text-black/40">
            Agent Device CLI
          </p>
          <h2 className="mt-2 font-display text-4xl font-medium leading-[1.1] text-black sm:text-[2.75rem]">
            The complete mobile toolkit for AI Agents.
          </h2>
        </div>

        <div className="mt-20 grid gap-12 lg:grid-cols-[192px_1fr] lg:gap-8">
          <ToolkitSectionNav items={lanes.map(({ id, step }) => ({ id, step }))} />

          <div className="flex flex-col gap-20 lg:gap-8">
            {lanes.map((lane) => (
              <article
                className="grid scroll-mt-8 gap-8 border-t border-black/10 pt-8 lg:min-h-[900px] lg:grid-cols-[1fr_528px] lg:border-t-0 lg:pt-4"
                id={lane.id}
                key={lane.id}
              >
                <div className="flex flex-col justify-between gap-10 lg:pr-28">
                  <div>
                    <p className="font-mono text-xs font-medium uppercase leading-5 text-black/40">
                      {lane.step}
                    </p>
                    <h3 className="mt-2 font-display text-3xl font-medium leading-[1.1] text-black sm:text-4xl">
                      {lane.title}
                    </h3>
                    <BodyText className="mt-10">{lane.body}</BodyText>
                    <div className="mt-10 border-b border-black/10">
                      {lane.bullets.map((bullet, bulletIndex) => {
                        const icon = lane.icons[bulletIndex];
                        return (
                          <div
                            className="flex items-center gap-5 border-t border-black/10 py-5 text-sm font-medium text-black"
                            key={bullet}
                          >
                            <PixelIcon
                              name={icon}
                              className="size-5 text-[#8232ff]"
                            />
                            <span>{bullet}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="rounded-[4px] bg-black/[0.04]">
                    <div className="flex items-center justify-between px-5 py-3 font-mono text-xs font-medium uppercase text-black">
                      <span>Start with prompt</span>
                      <PromptCopyButton prompt={lane.prompt} />
                    </div>
                    <p className="rounded-[4px] border border-black/10 bg-white px-5 py-4 font-mono text-sm leading-[1.5]">
                      {lane.prompt}
                    </p>
                  </div>
                </div>
                <div className="aspect-[528/868] overflow-hidden rounded-[4px] bg-black lg:h-[868px] lg:aspect-auto">
                  <Image
                    src={lane.image}
                    alt=""
                    width={laneImage.intrinsicWidth}
                    height={laneImage.intrinsicHeight}
                    sizes={`(max-width: 1024px) 100vw, ${laneImage.displayWidth}px`}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
