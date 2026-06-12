import { createLlmsTxt } from "@/lib/llms";

export const dynamic = "force-static";

export function GET() {
  return new Response(createLlmsTxt(), {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
