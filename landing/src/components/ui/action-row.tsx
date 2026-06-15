import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ActionRowProps = {
  children: ReactNode;
  className?: string;
};

export function ActionRow({ children, className }: ActionRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-10",
        className,
      )}
    >
      {children}
    </div>
  );
}
