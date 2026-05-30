"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type VideoPreviewSource = {
  src: string;
  type: string;
};

type VideoPreviewProps = {
  posterSrc: string;
  posterAlt: string;
  width: number;
  height: number;
  sizes?: string;
  sources?: VideoPreviewSource[];
  priority?: boolean;
  className?: string;
};

export function VideoPreview({
  posterSrc,
  posterAlt,
  width,
  height,
  sizes,
  sources = [],
  priority = false,
  className,
}: VideoPreviewProps) {
  const [videoReady, setVideoReady] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = sources.length > 0;

  useEffect(() => {
    if (!hasVideo) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    function syncMotionPreference() {
      setPrefersReducedMotion(mediaQuery.matches);
    }

    syncMotionPreference();
    mediaQuery.addEventListener("change", syncMotionPreference);

    return () => mediaQuery.removeEventListener("change", syncMotionPreference);
  }, [hasVideo]);

  useEffect(() => {
    if (hasVideo && prefersReducedMotion) {
      videoRef.current?.pause();
    }
  }, [hasVideo, prefersReducedMotion]);

  return (
    <div className={cn("relative aspect-video overflow-hidden bg-black", className)}>
      <Image
        src={posterSrc}
        alt={posterAlt}
        width={width}
        height={height}
        sizes={sizes}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          hasVideo && videoReady ? "opacity-0" : "opacity-100",
        )}
        priority={priority}
      />

      {hasVideo ? (
        <video
          aria-label={posterAlt}
          autoPlay={!prefersReducedMotion}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            videoReady ? "opacity-100" : "opacity-0",
          )}
          data-video-preview=""
          loop
          muted
          onCanPlay={() => setVideoReady(true)}
          onError={() => setVideoReady(false)}
          playsInline
          poster={posterSrc}
          preload="metadata"
          ref={videoRef}
        >
          {sources.map((source) => (
            <source key={source.src} src={source.src} type={source.type} />
          ))}
        </video>
      ) : null}
    </div>
  );
}
