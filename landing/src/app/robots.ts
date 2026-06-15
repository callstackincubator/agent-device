import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
      {
        userAgent: ["OAI-SearchBot", "ChatGPT-User"],
        allow: ["/", "/llms.txt", "/llms-full.txt"],
      },
      {
        userAgent: ["Claude-SearchBot", "Claude-User"],
        allow: ["/", "/llms.txt", "/llms-full.txt"],
        crawlDelay: 1,
      },
      {
        userAgent: ["PerplexityBot", "Perplexity-User"],
        allow: ["/", "/llms.txt", "/llms-full.txt"],
      },
      {
        userAgent: ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot"],
        allow: ["/", "/llms.txt", "/llms-full.txt"],
        crawlDelay: 1,
      },
      {
        userAgent: "Googlebot",
        allow: "/",
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
