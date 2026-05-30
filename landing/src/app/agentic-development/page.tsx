import type { Metadata } from "next";

import { JsonLd } from "@/components/json-ld";
import { ProductPage } from "@/components/product/product-page";
import { agenticDevelopmentPage } from "@/content/product-pages";
import { createPageJsonLd, createPageMetadata, seo } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(seo.pages.agenticDevelopment);

export default function AgenticDevelopmentRoute() {
  return (
    <>
      <JsonLd data={createPageJsonLd(seo.pages.agenticDevelopment)} />
      <ProductPage content={agenticDevelopmentPage} />
    </>
  );
}
