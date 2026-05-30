import { DarkNoisePanel } from "@/components/dark-noise-panel";
import { PixelIcon } from "@/components/pixel-icon";
import { SectionHeading } from "@/components/section-heading";
import { SectionShell } from "@/components/section-shell";
import { SiteHeader } from "@/components/site-header";
import { ActionRow } from "@/components/ui/action-row";
import { ButtonLink } from "@/components/ui/button";
import { CtaBand } from "@/components/ui/cta-band";
import { HeroBackdrop } from "@/components/ui/hero-backdrop";
import { IconCardGrid } from "@/components/ui/icon-card-grid";
import { DisplayHeading, Eyebrow, LeadText } from "@/components/ui/typography";
import type { ProductPageContent } from "@/content/product-pages";

export function ProductPage({ content }: { content: ProductPageContent }) {
  return (
    <main>
      <ProductHero content={content} />
      <ProblemSection content={content} />
      <ShiftSection content={content} />
      <WorkflowSection content={content} />
      <CapabilitiesSection content={content} />
      <SupportSections content={content} />
      <ProductCta content={content} />
    </main>
  );
}

function ProductHero({ content }: { content: ProductPageContent }) {
  return (
    <section className="noise-bg relative overflow-hidden bg-black px-5 pb-24 pt-32 text-center text-white sm:px-8 lg:min-h-[860px] lg:px-16 lg:pb-32 lg:pt-[170px]">
      <SiteHeader />
      <HeroBackdrop focus="high" />

      <div className="relative z-10 mx-auto flex max-w-[1088px] flex-col items-center">
        <Eyebrow tone="light">{content.eyebrow}</Eyebrow>
        <DisplayHeading as="h1" size="hero" tone="light" className="mt-3 lg:text-[60px]">
          {content.title}
        </DisplayHeading>
        <LeadText tone="light" className="mt-5 max-w-[720px] text-[18px] text-white/70">
          {content.description}
        </LeadText>
        <ActionRow className="mt-8 items-center justify-center sm:justify-center">
          <ButtonLink href="#get-started">{content.primaryAction}</ButtonLink>
        </ActionRow>

        <DarkNoisePanel className="mt-20 w-full max-w-[760px] p-5 text-left">
          <div className="grid gap-4 rounded-[4px] border border-white/10 bg-black/45 p-6 sm:grid-cols-3">
            {content.pillars.map((pillar) => (
              <div key={pillar.title}>
                <PixelIcon name={pillar.icon} className="size-5 text-[#8232ff]" />
                <DisplayHeading as="h2" size="card" tone="light" className="mt-6">
                  {pillar.title}
                </DisplayHeading>
                <LeadText tone="light" className="mt-2 text-sm">
                  {pillar.body}
                </LeadText>
              </div>
            ))}
          </div>
        </DarkNoisePanel>
      </div>
    </section>
  );
}

function ProblemSection({ content }: { content: ProductPageContent }) {
  return (
    <SectionShell>
      <div className="mx-auto grid max-w-[1088px] gap-10 lg:grid-cols-[360px_1fr]">
        <Eyebrow>Problem</Eyebrow>
        <div>
          <DisplayHeading>{content.problemTitle}</DisplayHeading>
          <LeadText className="mt-6 max-w-[720px] text-[18px]">{content.problemBody}</LeadText>
        </div>
      </div>
    </SectionShell>
  );
}

function ShiftSection({ content }: { content: ProductPageContent }) {
  return (
    <SectionShell className="pt-0 lg:pt-0">
      <DarkNoisePanel className="mx-auto max-w-[1312px] px-6 py-20 sm:px-10 lg:px-20">
        <div className="grid gap-12 lg:grid-cols-[420px_1fr]">
          <div>
            <Eyebrow tone="light">The shift</Eyebrow>
            <DisplayHeading tone="light" className="mt-2">
              {content.shiftTitle}
            </DisplayHeading>
            <LeadText tone="light" className="mt-6">
              {content.shiftBody}
            </LeadText>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {content.pillars.map((pillar) => (
              <article className="border border-white/10 bg-white/[0.04] p-6" key={pillar.title}>
                <PixelIcon name={pillar.icon} className="size-5 text-[#8232ff]" />
                <DisplayHeading as="h3" size="card" tone="light" className="mt-8">
                  {pillar.title}
                </DisplayHeading>
                <LeadText tone="light" className="mt-3">{pillar.body}</LeadText>
              </article>
            ))}
          </div>
        </div>
      </DarkNoisePanel>
    </SectionShell>
  );
}

function WorkflowSection({ content }: { content: ProductPageContent }) {
  return (
    <SectionShell>
      <div className="mx-auto grid max-w-[1312px] gap-12 lg:grid-cols-[528px_1fr]">
        <div>
          <Eyebrow>Workflow</Eyebrow>
          <DisplayHeading className="mt-2">{content.workflowTitle}</DisplayHeading>
          <LeadText className="mt-6">{content.workflowBody}</LeadText>
        </div>
        <div className="grid gap-3">
          {content.workflowSteps.map((step, index) => (
            <div
              className="flex items-center gap-5 rounded-[4px] border border-black/10 bg-black/[0.03] p-5 font-mono text-xs font-medium uppercase text-black"
              key={step}
            >
              <span className="text-black/35">{String(index + 1).padStart(2, "0")}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

function CapabilitiesSection({ content }: { content: ProductPageContent }) {
  return (
    <SectionShell className="pt-0 lg:pt-0">
      <SectionHeading
        eyebrow="Capabilities"
        title={content.capabilitiesTitle}
        description={content.capabilitiesBody}
      />
      <IconCardGrid cards={content.capabilities} />
    </SectionShell>
  );
}

function SupportSections({ content }: { content: ProductPageContent }) {
  return (
    <>
      {content.supportSections.filter((section) => !section.previewOnly).map((section) => (
        <SectionShell className="pt-0 lg:pt-0" key={section.title}>
          <div className="mx-auto grid max-w-[1312px] gap-12 border-t border-black/10 pt-16 lg:grid-cols-[420px_1fr]">
            <div>
              <Eyebrow>{section.eyebrow}</Eyebrow>
              <DisplayHeading className="mt-2">{section.title}</DisplayHeading>
              <LeadText className="mt-6">{section.body}</LeadText>
            </div>
            {section.cards ? (
              <div className="grid gap-4 md:grid-cols-2">
                {section.cards.map((card) => (
                  <article className="rounded-[4px] border border-black/10 bg-black/[0.03] p-6" key={card.title}>
                    <PixelIcon name={card.icon} className="size-5 text-[#8232ff]" />
                    <DisplayHeading as="h3" size="card" className="mt-8">
                      {card.title}
                    </DisplayHeading>
                    <LeadText className="mt-3">{card.body}</LeadText>
                  </article>
                ))}
              </div>
            ) : (
              <DarkNoisePanel className="min-h-[260px] p-6">
                <div className="flex h-full items-end rounded-[4px] border border-white/10 bg-black/45 p-6">
                  <LeadText tone="light" className="text-white/70">
                    {section.body}
                  </LeadText>
                </div>
              </DarkNoisePanel>
            )}
          </div>
        </SectionShell>
      ))}
    </>
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
      ]}
      size="compact"
    />
  );
}
