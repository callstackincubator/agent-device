import { PixelIcon } from "@/components/pixel-icon";
import { SectionShell } from "@/components/section-shell";
import { ButtonLink } from "@/components/ui/button";
import { DisplayHeading, Eyebrow, LeadText } from "@/components/ui/typography";
import { stackSupportItems } from "@/content/stack";

export function StackSupportSection() {
  return (
    <SectionShell id="demo" spacing="none">
      <section className="mx-auto grid min-h-[520px] max-w-[1312px] items-center gap-14 rounded-[4px] border border-black/10 px-6 py-16 sm:px-12 lg:min-h-[656px] lg:grid-cols-[minmax(0,448px)_minmax(0,520px)] lg:justify-between lg:px-28 lg:py-24">
        <div>
          <Eyebrow>Implementation support</Eyebrow>
          <DisplayHeading className="mt-3">Make it work in your stack.</DisplayHeading>
          <LeadText className="mt-6 max-w-[440px] text-[18px]">
            Agent Device works out of the box. Callstack can help you connect it
            to CI, hosted agents, React Native tooling, device infrastructure,
            and release process.
          </LeadText>
          <ButtonLink href="#demo" size="compact" variant="dark" className="mt-8">
            Book consultation
          </ButtonLink>
        </div>
        <div className="grid gap-9">
          {stackSupportItems.map((item) => (
            <article className="grid grid-cols-[24px_1fr] gap-6" key={item.title}>
              <PixelIcon name={item.icon} className="mt-1 size-5 text-[#8232ff]" />
              <div>
                <DisplayHeading as="h3" size="card">
                  {item.title}
                </DisplayHeading>
                <LeadText className="mt-2">{item.body}</LeadText>
              </div>
            </article>
          ))}
        </div>
      </section>
    </SectionShell>
  );
}
