import type { Metadata } from "next";

import { JsonLd } from "@/components/json-ld";
import { ProductPage } from "@/components/product/product-page";
import { agenticQaPage } from "@/content/product-pages";
import { createPageJsonLd, createPageMetadata, seo } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(seo.pages.agenticQa);

export default function AgenticQaRoute() {
  return (
    <>
      <JsonLd data={createPageJsonLd(seo.pages.agenticQa)} />
      <ProductPage content={agenticQaPage} />
    </>
  );
}
