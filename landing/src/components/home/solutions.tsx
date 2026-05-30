import { PixelIcon } from "@/components/pixel-icon";
import { SectionHeading } from "@/components/section-heading";
import { SectionShell } from "@/components/section-shell";
import { DisplayHeading, LeadText } from "@/components/ui/typography";
import { VideoPreview, type VideoPreviewSource } from "@/components/video-preview";
import { homeBenefits } from "@/content/home";

const agentDeviceVideoSources: VideoPreviewSource[] = [];

export function Solutions() {
  return (
    <SectionShell>
      <SectionHeading
        eyebrow="The mobile gap"
        title="Where agents stop, mobile reach starts."
        description="Coding agents ship backend, frontend, infra. Mobile breaks the loop. Agent Device closes it with the same workflow from laptop to remote workspace."
      />

      <div className="mx-auto mt-20 flex max-w-[1088px] flex-col gap-16">
        <div className="relative overflow-hidden rounded-[4px] border border-black/10 bg-black/[0.04]">
          <VideoPreview
            posterAlt="Agent Device product video preview"
            posterSrc="/figma/solution-media.webp"
            sources={agentDeviceVideoSources}
            width={1088}
            height={612}
            sizes="(max-width: 768px) 100vw, 1088px"
          />
          <button className="absolute left-1/2 top-1/2 flex h-10 -translate-x-1/2 -translate-y-1/2 items-center gap-4 rounded-[4px] bg-white py-1 pl-4 pr-1 text-sm font-medium text-black shadow-xl">
            What&apos;s Agent Device?
            <span className="flex size-8 items-center justify-center rounded-[2px] bg-black/5">
              <PixelIcon name="play" className="size-4" />
            </span>
          </button>
        </div>

        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {homeBenefits.map((benefit) => (
            <article className="flex flex-col gap-12" key={benefit.title}>
              <PixelIcon name={benefit.icon} className="size-5 text-[#8232ff]" />
              <div>
                <DisplayHeading as="h3" size="card">
                  {benefit.title}
                </DisplayHeading>
                <LeadText className="mt-3">{benefit.body}</LeadText>
              </div>
            </article>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
