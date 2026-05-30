import type { MetadataRoute } from "next";

import { seo } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: seo.siteName,
    short_name: "Agent Device",
    description: seo.defaultDescription,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#050009",
    theme_color: "#8232ff",
    categories: ["developer tools", "productivity"],
    icons: [
      {
        src: "/favicon.ico",
        sizes: "16x16 32x32 48x48",
        type: "image/x-icon",
      },
    ],
    screenshots: [
      {
        src: "/opengraph-image",
        sizes: "1200x630",
        type: "image/png",
        form_factor: "wide",
        label: seo.pages.home.ogTitle,
      },
    ],
  };
}
