import {
  createOgImage,
  ogImageContentType,
  ogImageSize,
} from "@/lib/og-image";
import { seo } from "@/lib/seo";

export const alt = seo.pages.agenticDevelopment.ogTitle;
export const contentType = ogImageContentType;
export const size = ogImageSize;

export default async function Image() {
  return await createOgImage({
    eyebrow: "Agentic Development",
    title: seo.pages.agenticDevelopment.ogTitle,
    description: seo.pages.agenticDevelopment.description,
  });
}
