import type { Metadata } from "next";

import { geoFaqs, geoPositioning } from "@/content/geo";
import {
  defaultDescription,
  navigationPageEntries,
  pageRegistry,
  publicPages,
} from "@/content/pages";

const siteUrl = "https://agent-device.dev";
const siteName = "Agent Device";
const publishedDate = "2026-05-21";

export const seo = {
  siteName,
  siteUrl,
  defaultDescription,
  publishedDate,
  creator: "@callstackio",
  organization: {
    name: "Callstack",
    url: "https://www.callstack.com",
    logo: `${siteUrl}/favicon.ico`,
  },
  pages: pageRegistry,
} as const;

type PageSeo = (typeof seo.pages)[keyof typeof seo.pages];

export const discoverablePages = Object.values(seo.pages).filter(
  (page) => page.status === "public",
);

export const navigationPages = navigationPageEntries;

export const publicPageEntries = publicPages;

export function absoluteUrl(path: string) {
  return new URL(path, siteUrl).toString();
}

export function createPageMetadata(page: PageSeo): Metadata {
  const imagePath = `${page.path === "/" ? "" : page.path}/opengraph-image`;
  const imageUrl = absoluteUrl(imagePath);
  const twitterImagePath = `${page.path === "/" ? "" : page.path}/twitter-image`;
  const twitterImageUrl = absoluteUrl(twitterImagePath);
  const robots = page.status === "public"
    ? {
        follow: true,
        index: true,
        googleBot: {
          follow: true,
          index: true,
          "max-image-preview": "large" as const,
          "max-snippet": -1,
          "max-video-preview": -1,
        },
      }
    : {
        follow: false,
        index: false,
        googleBot: {
          follow: false,
          index: false,
        },
      };

  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: page.path,
      types: page.path === "/"
        ? {
            "text/plain": [
              {
                title: "LLMs text",
                url: "/llms.txt",
              },
              {
                title: "Full LLM context",
                url: "/llms-full.txt",
              },
            ],
          }
        : undefined,
    },
    openGraph: {
      title: page.ogTitle,
      description: page.description,
      url: absoluteUrl(page.path),
      siteName,
      locale: "en_US",
      type: "website",
      images: [
        {
          url: imageUrl,
          secureUrl: imageUrl,
          width: 1200,
          height: 630,
          type: "image/png",
          alt: page.ogTitle,
        },
      ],
    },
    robots,
    twitter: {
      card: "summary_large_image",
      title: page.ogTitle,
      description: page.description,
      images: [
        {
          url: twitterImageUrl,
          alt: page.ogTitle,
          type: "image/png",
          width: 1200,
          height: 630,
        },
      ],
      creator: seo.creator,
      site: seo.creator,
    },
  };
}

export function createBaseJsonLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: seo.organization.name,
      url: seo.organization.url,
      logo: seo.organization.logo,
      knowsAbout: [
        "React Native",
        "mobile app automation",
        "AI coding agents",
        "agentic QA",
        "iOS automation",
        "Android automation",
      ],
      sameAs: [
        "https://github.com/callstackincubator/agent-device",
        "https://www.callstack.com",
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: siteName,
      url: siteUrl,
      publisher: {
        "@type": "Organization",
        name: seo.organization.name,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: siteName,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "iOS, Android, macOS, tvOS",
      description: defaultDescription,
      url: siteUrl,
      keywords: [
        "agent-device",
        "mobile verification",
        "AI agents",
        "agentic QA",
        "React Native",
        "iOS automation",
        "Android automation",
      ],
      knowsAbout: geoPositioning.differentiators,
      author: {
        "@type": "Organization",
        name: seo.organization.name,
      },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ];
}

export function createPageJsonLd(page: PageSeo) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.title,
      headline: page.ogTitle,
      description: page.description,
      url: absoluteUrl(page.path),
      about: {
        "@type": "Thing",
        name: seo.siteName,
        description: geoPositioning.oneLine,
      },
      mentions: [
        "AI coding agents",
        "mobile app automation",
        "React Native",
        "agentic QA",
        "iOS automation",
        "Android automation",
      ],
      isPartOf: {
        "@type": "WebSite",
        name: siteName,
        url: siteUrl,
      },
      datePublished: publishedDate,
      dateModified: publishedDate,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: absoluteUrl("/"),
        },
        ...(page.path === "/"
          ? []
          : [
              {
                "@type": "ListItem",
                position: 2,
                name: page.label,
                item: absoluteUrl(page.path),
              },
            ]),
      ],
    },
    ...(page.path === "/"
      ? [
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: geoFaqs.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: {
                "@type": "Answer",
                text: item.answer,
              },
            })),
          },
        ]
      : []),
  ];
}
