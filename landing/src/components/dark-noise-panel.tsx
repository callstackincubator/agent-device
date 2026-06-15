import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

type DarkNoisePanelProps = ComponentPropsWithoutRef<"div"> & {
  as?: "article" | "div";
  backgroundImage?: string;
  contentClassName?: string;
  purpleOverlay?: boolean;
  shaderOpacity?: string;
};

export function DarkNoisePanel({
  as: Component = "div",
  backgroundImage = "/figma/hero-shader.webp",
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
          "absolute inset-0 bg-cover bg-center",
          shaderOpacity,
        )}
        style={{ backgroundImage: `url(${backgroundImage})` }}
      />
      {purpleOverlay ? (
        <div className="absolute inset-0 bg-[#8232ff] mix-blend-color" />
      ) : null}
      <div className={cn("relative z-10", contentClassName)}>{children}</div>
    </Component>
  );
}
