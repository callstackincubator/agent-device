import type { MetadataRoute } from "next";

import { absoluteUrl, discoverablePages, seo } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(seo.publishedDate);

  return discoverablePages.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified,
    changeFrequency: "weekly",
    images: [absoluteUrl(`${page.path === "/" ? "" : page.path}/opengraph-image`)],
    priority: page.path === "/" ? 1 : 0.8,
  }));
}
