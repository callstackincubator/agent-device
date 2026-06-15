import { JsonLd } from "@/components/json-ld";
import { HomePage } from "@/components/home/home-page";
import { createPageJsonLd, seo } from "@/lib/seo";

export default function Home() {
  return (
    <>
      <JsonLd data={createPageJsonLd(seo.pages.home)} />
      <HomePage />
    </>
  );
}
