import Image from "next/image";

import { DarkNoisePanel } from "@/components/dark-noise-panel";
import { PixelIcon, type PixelIconName } from "@/components/pixel-icon";
import { SectionHeading } from "@/components/section-heading";
import { SectionShell } from "@/components/section-shell";
import { ButtonLink } from "@/components/ui/button";
import { BodyText, DisplayHeading } from "@/components/ui/typography";

const openSourceStats: Array<{
  value: string;
  label: string;
  icon: PixelIconName;
}> = [
  { value: "20M+", label: "Downloads / month", icon: "download" },
  { value: "10K+", label: "GitHub stars", icon: "github" },
  { value: "250+", label: "React Native commits", icon: "braces" },
];

const clientLogos = [
  {
    alt: "Evernote",
    height: 24,
    src: "/figma/logos/evernote.svg",
    width: 111,
  },
  {
    alt: "Ticketmaster",
    height: 14,
    src: "/figma/logos/ticketmaster.svg",
    width: 101,
  },
  {
    alt: "Expensify",
    height: 18,
    src: "/figma/logos/expensify.svg",
    width: 76,
  },
] as const;

export function WhyCallstack() {
  return (
    <SectionShell>
      <SectionHeading
        eyebrow=""
        title="Agent Device is built by Callstack"
        description="From billion-user apps to React Native core, this is why teams choose Callstack when they need to move fast and get it right."
      />
      <div className="mx-auto mt-16 grid max-w-[1152px] gap-8 lg:grid-cols-[minmax(0,672fr)_minmax(0,448fr)]">
        <DarkNoisePanel
          as="article"
          backgroundImage="/figma/callstack-card-bg.webp"
          className="min-h-[360px] p-8"
          purpleOverlay={false}
          shaderOpacity="opacity-100"
        >
          <div className="flex min-h-[296px] flex-col justify-between">
            <div>
              <DisplayHeading as="h3" size="card" tone="light" className="leading-[1.35]">
                10 years in React Native. Now shaping agentic engineering.
              </DisplayHeading>
              <BodyText tone="light" className="mt-4 max-w-[470px]">
                For a decade, we have helped define how teams ship with React
                Native. Now we are helping shape how they work with agents.
              </BodyText>
            </div>
            <p className="font-medium">Founded in 2016 · Backed by Viking Global Investors</p>
          </div>
        </DarkNoisePanel>

        <article className="rounded-[4px] border border-black/10 p-8">
          <DisplayHeading as="h3" size="card">
            100+ Enterprise clients with 7B+ users.
          </DisplayHeading>
          <BodyText className="mt-4 max-w-[430px]">
            We work with teams shipping at real scale. You get a partner used to
            high-stakes products, not learning on your roadmap.
          </BodyText>
          <div className="mt-20 grid grid-cols-[111fr_101fr_76fr] items-center gap-6">
            {clientLogos.map((logo) => (
              <Image
                alt={logo.alt}
                className="h-auto w-full"
                height={logo.height}
                key={logo.alt}
                src={logo.src}
                style={{ maxWidth: logo.width }}
                unoptimized
                width={logo.width}
              />
            ))}
          </div>
        </article>

        <article className="rounded-[4px] border border-black/10 p-8">
          <DisplayHeading as="h3" size="card">
            React Foundation members. Core Contributors.
          </DisplayHeading>
          <BodyText className="mt-4">
            We are founding members of React Foundation and Core Contributors to
            React Native. You get direct access to people close to the decisions
            shaping the frameworks you use.
          </BodyText>
          <div className="mt-12 flex justify-center">
            <Image
              alt=""
              aria-hidden="true"
              className="h-auto w-full max-w-[320px]"
              height={145}
              src="/figma/logos/react-foundation.webp"
              width={320}
            />
          </div>
        </article>

        <article className="rounded-[4px] bg-black/[0.04] p-8">
          <DisplayHeading as="h3" size="card">
            Open source since 2016. Our code runs in your app.
          </DisplayHeading>
          <BodyText className="mt-4">
            We contribute to React Native and maintain libraries across its
            ecosystem. Our code runs in apps used by millions of people every day.
          </BodyText>
          <ButtonLink
            href="https://github.com/callstackincubator/agent-device"
            size="compact"
            variant="light"
            className="mt-8"
          >
            Open Source Projects
          </ButtonLink>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {openSourceStats.map((stat) => (
              <div key={stat.value}>
                <PixelIcon name={stat.icon} className="size-5 text-[#8232ff]" />
                <DisplayHeading as="p" size="stat" className="mt-6">
                  {stat.value}
                </DisplayHeading>
                <p className="text-sm text-black/45">{stat.label}</p>
              </div>
            ))}
          </div>
        </article>

        <DarkNoisePanel
          as="article"
          className="min-h-[304px] p-8"
          id="events"
          purpleOverlay={false}
          shaderOpacity="opacity-0"
        >
          <DisplayHeading as="h3" size="card" tone="light">
            Agent Conf. The conference for the Agentic era.
          </DisplayHeading>
          <BodyText tone="light" className="mt-4 max-w-[430px]">
            The conference we built for the shift from writing code to
            orchestrating agents.
          </BodyText>
          <ButtonLink href="#events" size="compact" className="mt-28">
            Agent Conf
          </ButtonLink>
        </DarkNoisePanel>

        <article className="relative min-h-[304px] overflow-hidden rounded-[4px] border border-black/10 bg-gradient-to-br from-white to-[#eaf0ff] p-8">
          <DisplayHeading as="h3" size="card">We are Codex Ambassadors.</DisplayHeading>
          <BodyText className="mt-4 max-w-[420px]">
            We run meetups, workshops, and hands-on sessions that help teams
            learn Codex and apply it in real work.
          </BodyText>
          <ButtonLink href="#events" size="compact" variant="dark" className="mt-16">
            Check Events
          </ButtonLink>
          <PixelIcon
            name="handshake"
            className="absolute bottom-8 right-8 size-32 text-[#8232ff]/15"
          />
          <PixelIcon
            name="arrow-right"
            className="absolute bottom-10 right-24 size-20 text-white"
          />
        </article>
      </div>
    </SectionShell>
  );
}
