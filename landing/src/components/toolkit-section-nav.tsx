"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type ToolkitSectionNavItem = {
  id: string;
  step: string;
};

type ToolkitSectionNavProps = {
  items: ToolkitSectionNavItem[];
};

export function ToolkitSectionNav({ items }: ToolkitSectionNavProps) {
  const [activeId, setActiveId] = useState(items[0]?.id);

  useEffect(() => {
    let frame = 0;

    function updateActiveSection() {
      const targetLine = window.innerHeight * 0.42;
      let closestId = items[0]?.id;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const item of items) {
        const element = document.getElementById(item.id);

        if (!element) {
          continue;
        }

        const rect = element.getBoundingClientRect();

        if (rect.top <= targetLine && rect.bottom >= targetLine) {
          closestId = item.id;
          break;
        }

        const distance = Math.min(
          Math.abs(rect.top - targetLine),
          Math.abs(rect.bottom - targetLine),
        );

        if (distance < closestDistance) {
          closestDistance = distance;
          closestId = item.id;
        }
      }

      setActiveId((currentId) => (currentId === closestId ? currentId : closestId));
    }

    function scheduleUpdate() {
      if (frame) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateActiveSection();
      });
    }

    updateActiveSection();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }

      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [items]);

  return (
    <nav
      aria-label="Mobile toolkit sections"
      className="sticky top-8 hidden h-fit flex-col gap-1 font-mono text-xs font-medium uppercase leading-5 lg:flex"
    >
      {items.map((item) => {
        const isActive = item.id === activeId;

        return (
          <a
            aria-current={isActive ? "location" : undefined}
            className={cn(
              "relative block pl-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8232ff]",
              isActive
                ? "text-black before:absolute before:left-0 before:top-1/2 before:size-1.5 before:-translate-y-1/2 before:bg-[#8232ff]"
                : "text-black/35 hover:text-black",
            )}
            href={`#${item.id}`}
            key={item.id}
          >
            {item.step}
          </a>
        );
      })}
    </nav>
  );
}
