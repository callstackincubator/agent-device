import { DarkNoisePanel } from "@/components/dark-noise-panel";
import { PixelIcon, type PixelIconName } from "@/components/pixel-icon";
import { ButtonLink } from "@/components/ui/button";
import { DisplayHeading, Eyebrow, LeadText } from "@/components/ui/typography";

const platformCards: Array<{
  icon: PixelIconName;
  title: string;
  body: string;
}> = [
  {
    icon: "terminal",
    title: "Anywhere agents run",
    body: "Drive local simulators from CLI, CI, and remote workspaces with the same agent-device commands.",
  },
  {
    icon: "devices",
    title: "Devices on demand",
    body: "Map iOS and Android sessions into the agent loop without changing how teams work.",
  },
  {
    icon: "cloud",
    title: "Parallel at scale",
    body: "Run the same verification workflow across platforms, builds, and device states.",
  },
  {
    icon: "snapshot",
    title: "Evidence at scale",
    body: "Screenshots, recordings, logs, and accessibility snapshots stay attached to each run.",
  },
];

export function CloudOpenSection() {
  return (
    <section className="bg-white px-5 sm:px-8 lg:px-16">
      <DarkNoisePanel className="mx-auto min-h-[735px] max-w-[1312px] px-6 py-16 text-center sm:px-10 lg:h-[735px] lg:min-h-0 lg:px-16">
        <div className="mx-auto max-w-[820px]">
          <Eyebrow tone="light">Agent Device Cloud</Eyebrow>
          <div className="mx-auto mt-8 grid max-w-[280px] grid-cols-4 gap-2 text-white/70">
            {["terminal", "github", "devices", "cloud"].map((icon) => (
              <span
                className="flex aspect-square items-center justify-center rounded-[4px] border border-white/10 bg-white/[0.03]"
                key={icon}
              >
                <PixelIcon name={icon as PixelIconName} className="size-5" />
              </span>
            ))}
          </div>
          <div className="mx-auto mt-4 flex size-20 items-center justify-center rounded-[4px] border border-[#8232ff]/40 bg-[#8232ff]/10 text-[#9d6dff]">
            <PixelIcon name="cloud" className="size-7" />
          </div>
          <DisplayHeading as="h2" size="section" tone="light" className="mt-9">
            Mobile execution wherever your agents live.
          </DisplayHeading>
          <LeadText tone="light" className="mx-auto mt-3 max-w-[600px] text-sm">
            Agent Device runs from any agent machine. Cloud lifts iOS and Android
            into the same loop when local hardware is not available.
          </LeadText>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-[4px] border border-white/10 bg-white/10 text-left md:grid-cols-4">
          {platformCards.map((card) => (
            <article className="bg-black/60 p-5" key={card.title}>
              <PixelIcon name={card.icon} className="size-5 text-[#9d6dff]" />
              <h3 className="mt-8 text-sm font-medium leading-[1.35] text-white">
                {card.title}
              </h3>
              <p className="mt-3 text-xs leading-[1.5] text-white/45">{card.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink
            href="https://github.com/callstackincubator/agent-device"
            size="compact"
            variant="primary"
          >
            Agent Device Cloud
          </ButtonLink>
          <ButtonLink
            href="https://www.callstack.com/contact?message=%22I%20want%20to%20chat%20about%20agent-device%22"
            size="compact"
            variant="secondary"
          >
            Get a Demo
          </ButtonLink>
        </div>
      </DarkNoisePanel>
    </section>
  );
}
