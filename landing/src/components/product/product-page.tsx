import Image from "next/image";

import { DarkNoisePanel } from "@/components/dark-noise-panel";
import { Footer } from "@/components/home/footer";
import { Insights } from "@/components/home/insights";
import { PixelIcon } from "@/components/pixel-icon";
import { SectionShell } from "@/components/section-shell";
import { SiteHeader } from "@/components/site-header";
import { ActionRow } from "@/components/ui/action-row";
import { ButtonLink } from "@/components/ui/button";
import { CtaBand } from "@/components/ui/cta-band";
import { HeroBackdrop } from "@/components/ui/hero-backdrop";
import { DisplayHeading, Eyebrow, LeadText } from "@/components/ui/typography";
import type { ProductPageContent } from "@/content/product-pages";
import { cn } from "@/lib/utils";

export function ProductPage({ content }: { content: ProductPageContent }) {
  return (
    <main>
      <ProductHero content={content} />
      <ProblemStats content={content} />
      <LoopSection content={content} />
      <WorkflowPanel content={content} />
      <WorkCards content={content} />
      <FitSection content={content} />
      {content.pricing ? <PricingSection content={content} /> : null}
      <ProductCta content={content} />
      <StackSection content={content} />
      <FaqSection content={content} />
      <Insights />
      <Footer />
    </main>
  );
}

function ProductHero({ content }: { content: ProductPageContent }) {
  return (
    <section className="noise-bg relative overflow-hidden bg-black px-5 pb-20 pt-32 text-center text-white sm:px-8 lg:min-h-[860px] lg:px-16 lg:pb-40 lg:pt-[240px]">
      <SiteHeader />
      <HeroBackdrop focus="high" />

      <div className="relative z-10 mx-auto flex max-w-[1088px] flex-col items-center gap-16 lg:gap-[120px]">
        <div className="flex max-w-[1088px] flex-col items-center">
          <Eyebrow tone="light">{content.eyebrow}</Eyebrow>
          <DisplayHeading as="h1" size="hero" tone="light" className="mt-2 max-w-[1088px]">
            {content.title}
          </DisplayHeading>
          <LeadText tone="light" className="mt-5 max-w-[640px] text-[18px] text-white">
            {content.description}
          </LeadText>
          <ActionRow className="mt-8 justify-center sm:justify-center">
            <ButtonLink href="#get-started">{content.primaryAction}</ButtonLink>
            <ButtonLink href="#stack" variant="secondary">
              {content.secondaryAction}
            </ButtonLink>
          </ActionRow>
        </div>

        <div className="relative w-full overflow-hidden rounded-[4px] border border-white/10 bg-black">
          {content.heroMedia.type === "image" && content.heroMedia.src ? (
            <Image
              alt={content.heroMedia.alt ?? ""}
              className="aspect-[1088/612] h-auto w-full object-cover"
              height={612}
              priority
              src={content.heroMedia.src}
              width={1088}
            />
          ) : (
            <div className="flex aspect-[1088/612] items-center justify-center">
              <ButtonLink href="#workflow" size="compact" variant="primary">
                {content.heroMedia.cta ?? "Watch"}
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ProblemStats({ content }: { content: ProductPageContent }) {
  return (
    <SectionShell>
      <div className="mx-auto max-w-[1088px]">
        <div className="grid gap-8 lg:grid-cols-[448px_1fr] lg:items-start">
          <div>
            <Eyebrow>The problem</Eyebrow>
            <DisplayHeading as="h2" size="panel" className="mt-2 max-w-[430px]">
              {content.problemTitle}
            </DisplayHeading>
          </div>
          <LeadText className="max-w-[530px] lg:pt-11">{content.problemBody}</LeadText>
        </div>
        <div className="mt-20 grid gap-8 md:grid-cols-3">
          {content.stats.map((stat) => (
            <div key={stat.value}>
              <PixelIcon name="shuffle" className="size-4 text-[#8232ff]" />
              <DisplayHeading as="p" size="stat" className="mt-8">
                {stat.value}
              </DisplayHeading>
              <p className="mt-4 text-sm font-medium leading-[1.45] text-black">
                {stat.label}
              </p>
              <p className="mt-1 text-xs leading-[1.5] text-black/40">{stat.body}</p>
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

function LoopSection({ content }: { content: ProductPageContent }) {
  return (
    <SectionShell className="pt-0 lg:pt-0">
      <div className="mx-auto max-w-[1088px] text-center">
        <Eyebrow>The loop</Eyebrow>
        <DisplayHeading as="h2" size="panel" className="mt-2">
          {content.shiftTitle}
        </DisplayHeading>
        <LeadText className="mx-auto mt-4 max-w-[640px]">{content.shiftBody}</LeadText>
        <div className="mt-16 grid gap-4 md:grid-cols-3">
          {content.pillars.map((pillar) => (
            <article className="rounded-[4px] border border-black/10 p-8 text-left" key={pillar.title}>
              <PixelIcon name={pillar.icon} className="size-5 text-[#8232ff]" />
              <DisplayHeading as="h3" size="card" className="mt-12">
                {pillar.title}
              </DisplayHeading>
              <LeadText className="mt-3 text-sm">{pillar.body}</LeadText>
            </article>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

function WorkflowPanel({ content }: { content: ProductPageContent }) {
  return (
    <SectionShell className="pt-0 lg:pt-0" id="workflow">
      <DarkNoisePanel className="mx-auto max-w-[1088px] p-8 lg:p-16" purpleOverlay={false}>
        <div className="mx-auto max-w-[640px] text-center">
          <Eyebrow tone="light">Workflow</Eyebrow>
          <DisplayHeading as="h2" size="panel" tone="light" className="mt-2">
            {content.workflowTitle}
          </DisplayHeading>
          <LeadText tone="light" className="mt-4">{content.workflowBody}</LeadText>
        </div>
        <div className="mt-14 rounded-[4px] border border-white/10 bg-black/50 p-6">
          <div className="flex min-h-[220px] items-end justify-center text-center font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
            {content.workflowSteps.join("  ->  ")}
          </div>
        </div>
      </DarkNoisePanel>
    </SectionShell>
  );
}

function WorkCards({ content }: { content: ProductPageContent }) {
  return (
    <SectionShell className="pt-0 lg:pt-0">
      <div className="mx-auto max-w-[1088px] text-center">
        <Eyebrow>Capabilities</Eyebrow>
        <DisplayHeading as="h2" size="panel" className="mt-2">
          {content.capabilitiesTitle}
        </DisplayHeading>
        <LeadText className="mx-auto mt-4 max-w-[640px]">{content.capabilitiesBody}</LeadText>
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {content.capabilities.map((card) => (
            <article className="rounded-[4px] border border-black/10 p-6 text-left" key={card.title}>
              <PixelIcon name={card.icon} className="size-5 text-[#8232ff]" />
              <DisplayHeading as="h3" size="card" className="mt-12">
                {card.title}
              </DisplayHeading>
              <LeadText className="mt-3 text-sm">{card.body}</LeadText>
            </article>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

function FitSection({ content }: { content: ProductPageContent }) {
  const section = content.supportSections[0];

  if (!section) return null;

  return (
    <SectionShell className="pt-0 lg:pt-0">
      <div className="mx-auto grid max-w-[1088px] gap-12 border-t border-black/10 pt-16 lg:grid-cols-[420px_1fr]">
        <div>
          <Eyebrow>{section.eyebrow}</Eyebrow>
          <DisplayHeading as="h2" size="panel" className="mt-2">
            {section.title}
          </DisplayHeading>
          <LeadText className="mt-6">{section.body}</LeadText>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {section.cards?.map((card) => (
            <article className="rounded-[4px] border border-black/10 p-6" key={card.title}>
              <PixelIcon name={card.icon} className="size-5 text-[#8232ff]" />
              <DisplayHeading as="h3" size="card" className="mt-10">
                {card.title}
              </DisplayHeading>
              <LeadText className="mt-3 text-sm">{card.body}</LeadText>
            </article>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

function PricingSection({ content }: { content: ProductPageContent }) {
  if (!content.pricing) return null;

  return (
    <SectionShell className="pt-0 lg:pt-0">
      <div className="mx-auto max-w-[1088px] text-center">
        <Eyebrow>Pricing</Eyebrow>
        <DisplayHeading as="h2" size="panel" className="mt-2">
          {content.pricing.title}
        </DisplayHeading>
        <LeadText className="mx-auto mt-4 max-w-[620px]">{content.pricing.body}</LeadText>
        <div className="mt-12 grid gap-3 md:grid-cols-5">
          {content.pricing.plans.map((plan) => (
            <article
              className={cn(
                "rounded-[4px] border p-5 text-left",
                plan.highlighted ? "border-[#8232ff] bg-[#8232ff]/5" : "border-black/10",
              )}
              key={plan.name}
            >
              <p className="font-mono text-xs font-medium uppercase text-black/40">{plan.name}</p>
              <DisplayHeading as="p" size="card" className="mt-8">
                {plan.price}
              </DisplayHeading>
              <p className="mt-2 text-sm text-black/45">{plan.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

function ProductCta({ content }: { content: ProductPageContent }) {
  return (
    <CtaBand
      id="get-started"
      eyebrow="Get started"
      title={content.ctaTitle}
      body={content.ctaBody}
      actions={[
        {
          href: "https://github.com/callstackincubator/agent-device",
          label: content.primaryAction,
        },
        {
          href: "https://www.callstack.com/contact?message=%22I%20want%20to%20chat%20about%20agent-device%22",
          label: content.secondaryAction,
          variant: "secondary",
        },
      ]}
      size="compact"
    />
  );
}

function StackSection({ content }: { content: ProductPageContent }) {
  return (
    <SectionShell className="pt-0 lg:pt-0" id="stack">
      <div className="mx-auto grid max-w-[1088px] gap-12 rounded-[4px] border border-black/10 p-8 lg:grid-cols-[420px_1fr] lg:p-16">
        <div>
          <Eyebrow>Implementation support</Eyebrow>
          <DisplayHeading as="h2" size="panel" className="mt-2">
            {content.stack.title}
          </DisplayHeading>
          <LeadText className="mt-6">{content.stack.body}</LeadText>
          <ButtonLink
            className="mt-8"
            href="https://www.callstack.com/contact?message=%22I%20want%20to%20chat%20about%20agent-device%22"
            size="compact"
            variant="dark"
          >
            Book consultation
          </ButtonLink>
        </div>
        <div className="grid gap-6">
          {content.stack.items.map((item) => (
            <div className="grid gap-4 sm:grid-cols-[24px_1fr]" key={item.title}>
              <PixelIcon name={item.icon} className="size-5 text-[#8232ff]" />
              <div>
                <DisplayHeading as="h3" size="card">
                  {item.title}
                </DisplayHeading>
                <LeadText className="mt-2 text-sm">{item.body}</LeadText>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

function FaqSection({ content }: { content: ProductPageContent }) {
  return (
    <SectionShell className="pt-0 lg:pt-0">
      <div className="mx-auto grid max-w-[1088px] gap-12 border-t border-black/10 pt-16 lg:grid-cols-[420px_1fr]">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <DisplayHeading as="h2" size="panel" className="mt-2">
            {content.faq.title}
          </DisplayHeading>
          <LeadText className="mt-6">{content.faq.body}</LeadText>
        </div>
        <div className="divide-y divide-black/10">
          {content.faq.items.map((item) => (
            <details className="group py-6" key={item.question}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-black">
                {item.question}
                <PixelIcon name="arrow-right" className="size-4 transition group-open:rotate-90" />
              </summary>
              <LeadText className="mt-4 text-sm">{item.answer}</LeadText>
            </details>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
