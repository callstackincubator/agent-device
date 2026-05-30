import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

type DarkNoisePanelProps = ComponentPropsWithoutRef<"div"> & {
  as?: "article" | "div";
  contentClassName?: string;
  purpleOverlay?: boolean;
  shaderOpacity?: string;
};

export function DarkNoisePanel({
  as: Component = "div",
  children,
  className,
  contentClassName,
  purpleOverlay = true,
  shaderOpacity = "opacity-20",
  ...props
}: DarkNoisePanelProps) {
  return (
    <Component
      className={cn(
        "noise-bg relative overflow-hidden rounded-[4px] bg-black text-white",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "absolute inset-0 bg-[url('/figma/hero-shader.webp')] bg-cover bg-center",
          shaderOpacity,
        )}
      />
      {purpleOverlay ? (
        <div className="absolute inset-0 bg-[#8232ff] mix-blend-color" />
      ) : null}
      <div className={cn("relative z-10", contentClassName)}>{children}</div>
    </Component>
  );
}
