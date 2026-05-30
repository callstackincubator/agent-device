"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { heroCarouselCards } from "@/components/hero-carousel-data";
import { HeroWorkflowCard } from "@/components/hero-workflow-card";
import { cn } from "@/lib/utils";

export function HeroAgentCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const hoveredRef = useRef(false);
  const intervalRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);

  const stopAutoAdvance = useCallback(() => {
    if (!intervalRef.current) {
      return;
    }

    window.clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const startAutoAdvance = useCallback(() => {
    const paused = focusedRef.current || hoveredRef.current;

    if (paused || reducedMotionRef.current || document.hidden || intervalRef.current) {
      return;
    }

    intervalRef.current = window.setInterval(() => {
      setActiveIndex(
        (currentIndex) => (currentIndex + 1) % heroCarouselCards.length,
      );
    }, 3000);
  }, []);

  const syncAutoAdvance = useCallback(() => {
    stopAutoAdvance();
    startAutoAdvance();
  }, [startAutoAdvance, stopAutoAdvance]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    function syncMotionPreference() {
      reducedMotionRef.current = mediaQuery.matches;
      syncAutoAdvance();
    }

    syncMotionPreference();
    document.addEventListener("visibilitychange", syncAutoAdvance);
    mediaQuery.addEventListener("change", syncMotionPreference);

    return () => {
      stopAutoAdvance();
      document.removeEventListener("visibilitychange", syncAutoAdvance);
      mediaQuery.removeEventListener("change", syncMotionPreference);
    };
  }, [stopAutoAdvance, syncAutoAdvance]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const activeCard = viewport?.querySelector<HTMLElement>(
      `[data-carousel-card-index="${activeIndex}"]`,
    );

    if (!viewport || !activeCard) {
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    viewport.scrollTo({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      left: activeCard.offsetLeft - viewport.offsetLeft,
      top: 0,
    });
  }, [activeIndex]);

  return (
    <div
      aria-label="Agent workflow carousel"
      aria-live="polite"
      aria-roledescription="carousel"
      className="w-full max-w-[1180px]"
      data-active-index={activeIndex}
      onBlurCapture={(event) => {
        const nextFocusedElement = event.relatedTarget;

        if (
          nextFocusedElement instanceof Node &&
          event.currentTarget.contains(nextFocusedElement)
        ) {
          return;
        }

        focusedRef.current = false;
        startAutoAdvance();
      }}
      onFocusCapture={() => {
        focusedRef.current = true;
        stopAutoAdvance();
      }}
      onMouseEnter={() => {
        hoveredRef.current = true;
        stopAutoAdvance();
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        startAutoAdvance();
      }}
    >
      <div
        className="hero-carousel-viewport -mx-5 overflow-x-hidden px-5 sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0"
        ref={viewportRef}
      >
        <div className="flex gap-6 pb-12">
          {heroCarouselCards.map((card, index) => (
            <HeroWorkflowCard
              active={index === activeIndex}
              card={card}
              index={index}
              key={card.id}
            />
          ))}
        </div>
      </div>

      <div className="mt-2 flex justify-center gap-2">
        {heroCarouselCards.map((card, index) => (
          <button
            aria-label={`Show ${card.eyebrow}`}
            aria-pressed={index === activeIndex}
            className="flex h-10 w-10 items-center justify-center rounded-[2px] outline-none transition focus-visible:ring-2 focus-visible:ring-[#8232ff] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            key={card.id}
            onClick={() => setActiveIndex(index)}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-8 rounded-full border border-white/15 bg-white/10 transition",
                index === activeIndex && "border-[#8232ff] bg-[#8232ff]",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
