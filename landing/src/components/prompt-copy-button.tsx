"use client";

import { useEffect, useRef, useState } from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { cn } from "@/lib/utils";

type PromptCopyButtonProps = {
  prompt: string;
  className?: string;
};

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy selection path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } catch {
    // The visual confirmation is optimistic; copy failures are non-fatal here.
  }

  document.body.removeChild(textarea);
}

export function PromptCopyButton({ prompt, className }: PromptCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  function handleCopy() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setCopied(true);

    timeoutRef.current = setTimeout(() => {
      setCopied(false);
      timeoutRef.current = null;
    }, 2000);

    void copyText(prompt);
  }

  return (
    <button
      aria-label={copied ? "Prompt copied" : "Copy prompt"}
      className={cn(
        "group inline-flex h-8 min-w-8 items-center justify-center gap-2 rounded-[2px] px-2 text-black/60 outline-none transition hover:bg-black/5 hover:text-black focus-visible:ring-2 focus-visible:ring-[#8232ff] focus-visible:ring-offset-2",
        copied && "copy-confirmation text-[#8232ff]",
        className,
      )}
      onClick={handleCopy}
      type="button"
    >
      <span className={copied ? "hidden" : undefined}>
        <PixelIcon
          name="copy"
          className="size-4 transition group-hover:scale-110"
          aria-hidden="true"
        />
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "items-center gap-2 text-[10px] font-medium uppercase",
          copied ? "inline-flex" : "hidden",
        )}
      >
        Copied!
        <PixelIcon name="check" className="size-4" aria-hidden="true" />
      </span>
    </button>
  );
}
