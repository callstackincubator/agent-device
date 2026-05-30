import Link from "next/link";
import { memo } from "react";

import type { HeroCarouselCardData, HeroCarouselCardStatus } from "@/components/hero-carousel-data";
import { PixelIcon, type PixelIconName } from "@/components/pixel-icon";
import { cn } from "@/lib/utils";

const statusMeta = {
  done: {
    icon: "check",
    label: "Done",
    className: "bg-[#a6e34a]/30 text-[#a6e34a]",
  },
  pending: {
    icon: "clock",
    label: "Queued",
    className: "bg-white/10 text-white/45",
  },
  error: {
    icon: "terminal",
    label: "Needs attention",
    className: "bg-[#ff5a3d]/20 text-[#ff8f7a]",
  },
} satisfies Record<
  HeroCarouselCardStatus,
  { icon: PixelIconName; label: string; className: string }
>;

type HeroWorkflowCardProps = {
  active: boolean;
  card: HeroCarouselCardData;
  index: number;
};

export const HeroWorkflowCard = memo(function HeroWorkflowCard({
  active,
  card,
  index,
}: HeroWorkflowCardProps) {
  const status = statusMeta[card.status];

  return (
    <article
      aria-label={`${card.eyebrow}: ${card.title}`}
      className={cn(
        "hero-carousel-card overflow-hidden rounded-[4px] border bg-black/40 backdrop-blur transition duration-500",
        active
          ? "border-[#8232ff] shadow-[0_64px_96px_-40px_rgba(130,50,255,0.8)]"
          : "border-white/10 opacity-70",
      )}
      data-carousel-card-index={index}
      data-hero-carousel-card=""
    >
      <div
        className={cn(
          "flex min-h-28 items-center gap-5 border-b p-5 sm:p-6",
          active ? "border-[#8232ff] bg-white/[0.04]" : "border-white/10",
        )}
      >
        <div
          className={cn(
            "flex size-14 items-center justify-center rounded-[4px] border sm:size-16",
            active
              ? "border-[#8232ff] bg-black/40 text-[#8232ff]"
              : "border-white/10 bg-black/25 text-white/40",
          )}
        >
          <PixelIcon name={card.icon} className="size-5 sm:size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-white">{card.eyebrow}</p>
          <p className="mt-1 font-mono text-xs font-medium uppercase leading-5 text-white/40">
            {card.title}
          </p>
        </div>
        <span
          aria-label={status.label}
          className={cn(
            "flex h-6 w-8 items-center justify-center rounded-full",
            status.className,
          )}
          title={status.label}
        >
          <PixelIcon name={status.icon} className="size-4" />
        </span>
      </div>

      <div className="px-5 sm:px-6">
        {card.rows.map((row) => (
          <div
            className="grid grid-cols-[minmax(96px,auto)_minmax(0,1fr)] items-center gap-3 border-t border-white/10 py-5 first:border-t-0"
            key={row.label}
          >
            <div className="flex min-w-0 items-center gap-2 text-white/60">
              <PixelIcon name={row.icon} className="size-4" />
              <span className="font-mono text-xs font-medium uppercase">
                {row.label}
              </span>
            </div>
            <span className="break-words text-right font-mono text-xs font-medium uppercase leading-5 text-white">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {card.action ? (
        <div className="px-5 pb-5 sm:px-6 sm:pb-6">
          <Link
            className="group inline-flex h-9 items-center gap-3 rounded-[4px] border border-white/15 bg-white/[0.04] py-1 pl-3 pr-1 font-mono text-xs font-medium uppercase text-white transition hover:border-white/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8232ff]"
            href={card.action.href}
          >
            <span>{card.action.label}</span>
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-[2px] bg-white/10 transition group-hover:translate-x-0.5"
            >
              <PixelIcon name="arrow-right" className="size-4" />
            </span>
          </Link>
        </div>
      ) : null}
    </article>
  );
});
