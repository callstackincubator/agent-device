import {
  createOgImage,
  ogImageContentType,
  ogImageSize,
} from "@/lib/og-image";
import { seo } from "@/lib/seo";

export const alt = seo.pages.agenticQa.ogTitle;
export const contentType = ogImageContentType;
export const size = ogImageSize;

export default async function Image() {
  return await createOgImage({
    eyebrow: "Agentic QA",
    title: seo.pages.agenticQa.ogTitle,
    description: seo.pages.agenticQa.description,
  });
}
