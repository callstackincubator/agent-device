import { SectionShell } from "@/components/section-shell";
import { insightCards } from "@/content/insights";

export function Insights() {
  return (
    <SectionShell className="overflow-hidden lg:py-24">
      <div className="mx-auto max-w-[1312px]">
        <p className="font-mono text-xs font-medium uppercase leading-5 text-black/40">
          Insights
        </p>
        <h2 className="mt-2 font-display text-4xl font-medium leading-[1.1] text-black sm:text-[2.75rem]">
          Worth your time, by engineers.
        </h2>
        <div className="mt-16 flex gap-8 overflow-x-auto pb-4">
          {insightCards.map((post) => (
            <a
              aria-label={`Read ${post.type.toLowerCase()}: ${post.title}`}
              className="group block min-w-[360px] max-w-[420px] rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[#8232ff] focus-visible:ring-offset-4"
              href={post.href}
              key={post.href}
            >
              <div className="noise-bg flex aspect-[1.9] items-end rounded-[4px] bg-black p-5 text-white">
                <div>
                  <p className="font-mono text-[10px] font-medium uppercase text-[#a6e34a]">
                    {post.type}
                  </p>
                  <p
                    aria-hidden="true"
                    className="mt-8 max-w-[280px] font-display text-2xl font-medium leading-[1.1] transition group-hover:text-white/80"
                  >
                    {post.title}
                  </p>
                </div>
              </div>
              <p className="mt-8 font-mono text-xs font-medium uppercase leading-5 text-black/40">
                {post.date} · {post.type}
              </p>
              <h3 className="mt-2 font-display text-2xl font-medium leading-[1.15] text-black transition group-hover:text-[#8232ff]">
                {post.title}
              </h3>
              <p className="mt-6 leading-[1.5] text-black/40">
                {post.body}
              </p>
            </a>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
