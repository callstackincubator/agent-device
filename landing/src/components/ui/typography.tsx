import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

type Tone = "dark" | "light";

const toneClasses: Record<Tone, { text: string; muted: string; eyebrow: string }> = {
  dark: {
    text: "text-black",
    muted: "text-black/60",
    eyebrow: "text-black/40",
  },
  light: {
    text: "text-white",
    muted: "text-white/60",
    eyebrow: "text-white/40",
  },
};

type TextProps = {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  tone?: Tone;
};

type DisplayHeadingProps = TextProps & {
  size?: "hero" | "section" | "panel" | "card" | "stat";
};

type BodyTextProps = TextProps & {
  size?: "regular" | "medium";
};

export function Eyebrow({
  as: Component = "p",
  children,
  className,
  tone = "dark",
}: TextProps) {
  return (
    <Component
      className={cn(
        "font-mono text-xs font-medium uppercase leading-5",
        toneClasses[tone].eyebrow,
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function DisplayHeading({
  as: Component = "h2",
  children,
  className,
  size = "section",
  tone = "dark",
}: DisplayHeadingProps) {
  return (
    <Component
      className={cn(
        size === "card" ? "font-sans font-medium" : "font-display font-medium",
        size === "hero" && "text-[3rem] leading-[1.1] sm:text-[4rem] lg:text-[60px]",
        size === "section" && "text-4xl leading-[1.1] sm:text-[2.75rem]",
        size === "panel" && "text-3xl leading-[1.1]",
        size === "card" && "font-sans text-[18px] leading-[1.5]",
        size === "stat" && "text-3xl leading-none",
        toneClasses[tone].text,
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function LeadText({
  as: Component = "p",
  children,
  className,
  tone = "dark",
}: TextProps) {
  return (
    <Component
      className={cn("leading-[1.5]", toneClasses[tone].muted, className)}
    >
      {children}
    </Component>
  );
}

export function BodyText({
  as: Component = "p",
  children,
  className,
  size = "regular",
  tone = "dark",
}: BodyTextProps) {
  return (
    <Component
      className={cn(
        "leading-[1.5]",
        size === "regular" && "text-base",
        size === "medium" && "text-[18px]",
        toneClasses[tone].muted,
        className,
      )}
    >
      {children}
    </Component>
  );
}
