import {
  createOgImage,
  ogImageContentType,
  ogImageSize,
} from "@/lib/og-image";
import { seo } from "@/lib/seo";

export const alt = seo.pages.home.ogTitle;
export const contentType = ogImageContentType;
export const size = ogImageSize;

export default async function Image() {
  return await createOgImage({
    eyebrow: "Agent Device",
    title: seo.pages.home.ogTitle,
    description: seo.pages.home.description,
  });
}
