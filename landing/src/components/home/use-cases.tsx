"use client";

import { type KeyboardEvent, useState } from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { SectionHeading } from "@/components/section-heading";
import { SectionShell } from "@/components/section-shell";
import { ButtonLink } from "@/components/ui/button";
import { BodyText } from "@/components/ui/typography";
import { homeUseCases } from "@/content/home";
import { cn } from "@/lib/utils";

export function UseCases() {
  const [activeId, setActiveId] = useState(homeUseCases[0].id);
  const activeCase =
    homeUseCases.find((useCase) => useCase.id === activeId) ?? homeUseCases[0];

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = homeUseCases.findIndex(
      (useCase) => useCase.id === event.currentTarget.dataset.tabId,
    );

    if (currentIndex < 0) {
      return;
    }

    const direction =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;

    if (direction === 0) {
      return;
    }

    event.preventDefault();
    const nextIndex =
      (currentIndex + direction + homeUseCases.length) % homeUseCases.length;
    const nextCase = homeUseCases[nextIndex];

    setActiveId(nextCase.id);
    document.getElementById(`${nextCase.id}-tab`)?.focus();
  }

  return (
    <SectionShell className="lg:min-h-[1394px] lg:py-[120px]" id="use-cases">
      <SectionHeading eyebrow="Use cases" title="Where mobile teams ship faster." />
      <div className="mx-auto mt-16 max-w-[1312px]">
        <div
          className="grid border-b border-black/10 font-mono text-xs font-medium uppercase leading-5 text-black/35 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Use case tabs"
          role="tablist"
        >
          {homeUseCases.map((useCase) => {
            const isActive = useCase.id === activeCase.id;

            return (
              <button
                aria-controls={`${useCase.id}-panel`}
                aria-selected={isActive}
                className={cn(
                  "border-b px-0 pb-4 pt-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#8232ff] focus-visible:ring-offset-2 sm:px-3",
                  isActive
                    ? "border-black text-black"
                    : "border-transparent hover:border-black/20 hover:text-black/60",
                )}
                data-tab-id={useCase.id}
                id={`${useCase.id}-tab`}
                key={useCase.id}
                onClick={() => setActiveId(useCase.id)}
                onKeyDown={handleTabKeyDown}
                role="tab"
                tabIndex={isActive ? 0 : -1}
                type="button"
              >
                {useCase.label}
              </button>
            );
          })}
        </div>

        <div
          aria-labelledby={`${activeCase.id}-tab`}
          className="mt-16 grid gap-10 lg:grid-cols-[528px_1fr] lg:gap-36"
          id={`${activeCase.id}-panel`}
          role="tabpanel"
          tabIndex={0}
        >
          <div>
            <div className="flex flex-wrap gap-1">
              {activeCase.tags.map((tag) => (
                <span
                  className="inline-flex items-center gap-1.5 rounded-[4px] bg-black/[0.04] px-2 py-1 text-xs font-medium text-black/40"
                  key={tag.label}
                >
                  <PixelIcon name={tag.icon} className="size-3.5" />
                  {tag.label}
                </span>
              ))}
            </div>
            <h3 className="mt-2 font-display text-4xl font-medium leading-[1.1] text-black">
              {activeCase.title}
            </h3>
            <BodyText className="mt-8">{activeCase.body}</BodyText>
            <div className="mt-8 border-b border-black/10">
              {activeCase.rows.map((row) => (
                <div
                  className="flex items-center gap-5 border-t border-black/10 py-5 text-sm font-medium"
                  key={row.text}
                >
                  <PixelIcon name={row.icon} className="size-5 shrink-0 text-[#8232ff]" />
                  <span>{row.text}</span>
                </div>
              ))}
            </div>
            <ButtonLink
              href={activeCase.href}
              size="compact"
              variant="light"
              className="mt-8"
            >
              {activeCase.cta}
            </ButtonLink>
          </div>
          <div className="flex min-h-[420px] flex-col justify-between rounded-[4px] border border-black/10 bg-black/[0.04] p-6 text-black sm:p-8">
            <div>
              <p className="font-mono text-xs font-medium uppercase text-black/40">
                {activeCase.demoTitle}
              </p>
              <div className="mt-8 grid gap-3">
                {activeCase.demoSteps.map((step, index) => (
                  <div
                    className="flex items-center gap-4 border border-black/10 bg-white/65 p-4 font-mono text-xs font-medium uppercase text-black/65"
                    key={step}
                  >
                    <span className="text-black/30">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-12 grid grid-cols-3 gap-2 font-mono text-[10px] font-medium uppercase text-black/40">
              {["Snapshot", "Logs", "Video"].map((item) => (
                <span
                  className="flex h-20 items-end rounded-[4px] border border-black/10 bg-white/60 p-3"
                  key={item}
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
