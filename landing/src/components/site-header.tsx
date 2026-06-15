import Link from "next/link";
import { Suspense } from "react";

import { GitHubStarLink, GitHubStarLinkFallback } from "@/components/github-star-link";
import { PixelIcon } from "@/components/pixel-icon";
import { ButtonLink } from "@/components/ui/button";
import { navigationPages } from "@/lib/seo";

export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-30 h-[72px] border-b border-white/10 bg-black/25 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 font-display text-xl font-semibold text-white"
        >
          <PixelIcon name="device" className="size-4" aria-hidden="true" />
          Agent Device
        </Link>
        <nav
          className="hidden items-center gap-8 text-xs font-medium uppercase text-white/45 lg:flex"
          aria-label="Main navigation"
        >
          {navigationPages.map((item) => (
            <Link
              className="transition hover:text-white"
              href={item.path}
              key={item.path}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <Suspense fallback={<GitHubStarLinkFallback />}>
            <GitHubStarLink />
          </Suspense>
          <ButtonLink href="#get-started" size="compact">
            Get Started
          </ButtonLink>
        </div>
        <ButtonLink
          href="#get-started"
          size="compact"
          variant="secondary"
          className="lg:hidden"
        >
          Get Started
        </ButtonLink>
      </div>
    </header>
  );
}
