import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group inline-flex items-center justify-between outline-none transition focus-visible:ring-2 focus-visible:ring-[#8232ff] focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        primary: "bg-white text-black hover:bg-white/90 focus-visible:ring-offset-black",
        secondary:
          "border border-white/15 bg-transparent text-white hover:border-white/30 hover:bg-white/5 focus-visible:ring-offset-black",
        light:
          "border border-black/15 bg-white text-black hover:bg-black/[0.03] focus-visible:ring-offset-white",
        dark: "border border-white/15 bg-black text-white hover:bg-black/85 focus-visible:ring-offset-white",
      },
      size: {
        large:
          "h-10 w-full gap-4 rounded-[4px] py-1 pl-4 pr-1 text-sm font-medium leading-none sm:w-auto sm:min-w-[136px]",
        compact:
          "h-10 gap-4 rounded-[4px] py-1 pl-4 pr-1 text-sm font-medium leading-none",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "large",
    },
  },
);

type ButtonLinkProps = ComponentPropsWithoutRef<typeof Link> &
  VariantProps<typeof buttonVariants>;

export function ButtonLink({
  className,
  children,
  variant,
  size,
  ...props
}: ButtonLinkProps) {
  const resolvedVariant = variant ?? "primary";
  const iconTone =
    resolvedVariant === "primary" || resolvedVariant === "light"
      ? "bg-black/5 text-black"
      : "bg-white/15 text-white";
  const iconSize = size === "compact"
    ? "size-8 rounded-[2px]"
    : "size-8 rounded-[2px]";
  const glyphSize = "size-4";

  return (
    <Link className={cn(buttonVariants({ variant, size }), className)} {...props}>
      <span className="min-w-0 whitespace-nowrap">{children}</span>
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center transition group-hover:translate-x-0.5",
          iconSize,
          iconTone,
        )}
      >
        <PixelIcon name="arrow-right" className={glyphSize} aria-hidden="true" />
      </span>
    </Link>
  );
}
