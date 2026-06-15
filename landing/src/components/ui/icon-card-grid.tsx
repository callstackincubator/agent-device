import { PixelIcon, type PixelIconName } from "@/components/pixel-icon";
import { DisplayHeading, LeadText } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

export type IconCard = {
  icon: PixelIconName;
  title: string;
  body: string;
};

type IconCardGridProps = {
  cards: IconCard[];
  className?: string;
  tone?: "dark" | "light";
};

export function IconCardGrid({ cards, className, tone = "dark" }: IconCardGridProps) {
  const isLight = tone === "light";

  return (
    <div
      className={cn(
        "mx-auto mt-16 grid max-w-[1088px] gap-8 md:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {cards.map((card) => (
        <article
          className={cn("border-t pt-8", isLight ? "border-white/10" : "border-black/10")}
          key={card.title}
        >
          <PixelIcon name={card.icon} className="size-5 text-[#8232ff]" />
          <DisplayHeading as="h3" size="card" tone={tone} className="mt-8">
            {card.title}
          </DisplayHeading>
          <LeadText tone={tone} className="mt-3">
            {card.body}
          </LeadText>
        </article>
      ))}
    </div>
  );
}
