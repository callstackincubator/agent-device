import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

type SectionShellProps = ComponentPropsWithoutRef<"section"> & {
  spacing?: "default" | "none";
};

export function SectionShell({
  children,
  className,
  spacing = "default",
  ...props
}: SectionShellProps) {
  return (
    <section
      className={cn(
        "bg-white px-5 sm:px-8 lg:px-16",
        spacing === "default" && "py-24 lg:py-[120px]",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}
