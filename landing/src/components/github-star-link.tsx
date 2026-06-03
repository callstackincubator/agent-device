import Link from "next/link";

import { PixelIcon } from "@/components/pixel-icon";
import {
  formatStarCount,
  getGitHubRepoStats,
  githubRepoUrl,
} from "@/lib/github";
import { cn } from "@/lib/utils";

type GitHubStarLinkProps = {
  className?: string;
};

const baseClassName =
  "inline-flex h-10 items-center gap-3 rounded-[4px] border border-white/15 bg-white/[0.04] px-3 text-sm font-medium leading-none text-white transition hover:border-white/30 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8232ff] focus-visible:ring-offset-2 focus-visible:ring-offset-black";

export async function GitHubStarLink({ className }: GitHubStarLinkProps) {
  const stats = await getGitHubRepoStats();
  const starLabel = stats ? formatStarCount(stats.stars) : null;
  const ariaLabel = stats
    ? `Open Agent Device on GitHub, ${stats.stars.toLocaleString("en-US")} stars`
    : "Open Agent Device on GitHub";

  return (
    <Link
      aria-label={ariaLabel}
      className={cn(baseClassName, className)}
      href={githubRepoUrl}
      rel="noreferrer"
      target="_blank"
    >
      <span>GitHub</span>
      <span className="flex items-center gap-1.5 text-white/65">
        <PixelIcon name="star" className="size-4 text-[#8232ff]" />
        <span>{starLabel ?? "Stars"}</span>
      </span>
    </Link>
  );
}

export function GitHubStarLinkFallback({ className }: GitHubStarLinkProps) {
  return (
    <Link
      aria-label="Open Agent Device on GitHub"
      className={cn(baseClassName, className)}
      href={githubRepoUrl}
      rel="noreferrer"
      target="_blank"
    >
      <span>GitHub</span>
      <span className="flex items-center gap-1.5 text-white/65">
        <PixelIcon name="star" className="size-4 text-[#8232ff]" />
        <span>Stars</span>
      </span>
    </Link>
  );
}
