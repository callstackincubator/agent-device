import { HeroAgentCarousel } from "@/components/hero-agent-carousel";
import { SiteHeader } from "@/components/site-header";
import { ActionRow } from "@/components/ui/action-row";
import { ButtonLink } from "@/components/ui/button";
import { HeroBackdrop } from "@/components/ui/hero-backdrop";
import { DisplayHeading, Eyebrow, LeadText } from "@/components/ui/typography";
import { homeHero } from "@/content/home";

export function Hero() {
  return (
    <section className="noise-bg relative flex min-h-[900px] overflow-hidden bg-black px-5 pb-36 pt-36 text-white sm:px-8 lg:min-h-[1233px] lg:px-16 lg:pb-40 lg:pt-[170px]">
      <SiteHeader />
      <HeroBackdrop />

      <div className="relative z-10 mx-auto flex w-full max-w-[1312px] flex-col items-center gap-16 lg:gap-20">
        <div className="max-w-[760px] text-center">
          <Eyebrow tone="light">Interact → Debug → Profile → Capture → Test E2E</Eyebrow>
          <DisplayHeading
            as="h1"
            size="hero"
            tone="light"
            className="mt-2 leading-[1.1] lg:text-[60px]"
          >
            The mobile verification
            <br className="hidden sm:block" /> for AI Agents.
          </DisplayHeading>
          <LeadText tone="light" className="mx-auto mt-5 max-w-[640px] text-base text-white sm:text-[18px]">
            {homeHero.description}
          </LeadText>
          <ActionRow className="mt-8 items-center justify-center sm:justify-center">
            <ButtonLink href="#get-started">Get Started</ButtonLink>
          </ActionRow>
        </div>

        <HeroAgentCarousel />
      </div>
    </section>
  );
}
