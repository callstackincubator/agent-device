import type { ReactNode } from "react";

import { DarkNoisePanel } from "@/components/dark-noise-panel";
import { SectionShell } from "@/components/section-shell";
import { ActionRow } from "@/components/ui/action-row";
import { ButtonLink } from "@/components/ui/button";
import { DisplayHeading, Eyebrow, LeadText } from "@/components/ui/typography";

type CtaBandAction = {
  href: string;
  label: string;
  variant?: "primary" | "secondary" | "light" | "dark";
};

type CtaBandProps = {
  id?: string;
  eyebrow: ReactNode;
  title: ReactNode;
  body: ReactNode;
  actions: CtaBandAction[];
  size?: "compact" | "default" | "tall";
};

const sizeClasses = {
  compact: "min-h-[420px]",
  default: "min-h-[520px]",
  tall: "min-h-[702px]",
} as const;

export function CtaBand({
  id,
  eyebrow,
  title,
  body,
  actions,
  size = "default",
}: CtaBandProps) {
  return (
    <SectionShell id={id} spacing="none">
      <DarkNoisePanel
        className={`mx-auto flex ${sizeClasses[size]} max-w-[1312px] items-center justify-center px-6 py-24 text-center`}
      >
        <div className="max-w-[720px]">
          <Eyebrow tone="light">{eyebrow}</Eyebrow>
          <DisplayHeading tone="light" className="mt-2 text-5xl leading-[1.08] sm:text-[4rem]">
            {title}
          </DisplayHeading>
          <LeadText tone="light" className="mx-auto mt-5 max-w-[640px] text-[18px]">
            {body}
          </LeadText>
          {actions.length ? (
            <ActionRow className="mt-8 items-center justify-center sm:justify-center">
              {actions.map((action) => (
                <ButtonLink
                  href={action.href}
                  key={`${action.href}-${action.label}`}
                  variant={action.variant}
                >
                  {action.label}
                </ButtonLink>
              ))}
            </ActionRow>
          ) : null}
        </div>
      </DarkNoisePanel>
    </SectionShell>
  );
}
