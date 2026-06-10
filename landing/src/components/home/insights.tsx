import { SectionShell } from "@/components/section-shell";
import { insightCards } from "@/content/insights";

export function Insights() {
  return (
    <SectionShell className="overflow-hidden lg:min-h-[650px] lg:py-[72px]">
      <div className="mx-auto max-w-[1312px]">
        <p className="font-mono text-xs font-medium uppercase leading-5 text-black/40">
          Insights
        </p>
        <h2 className="mt-2 font-display text-4xl font-medium leading-[1.1] text-black sm:text-[2.75rem]">
          Worth your time, by engineers.
        </h2>
        <div className="mt-14 flex gap-6 overflow-x-auto pb-4">
          {insightCards.map((post) => (
            <a
              aria-label={`Read ${post.type.toLowerCase()}: ${post.title}`}
              className="group block min-w-[320px] max-w-[360px] rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[#8232ff] focus-visible:ring-offset-4"
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
                    className="mt-7 max-w-[260px] font-display text-xl font-medium leading-[1.1] transition group-hover:text-white/80"
                  >
                    {post.title}
                  </p>
                </div>
              </div>
              <p className="mt-6 font-mono text-xs font-medium uppercase leading-5 text-black/40">
                {post.date} · {post.type}
              </p>
              <h3 className="mt-2 font-display text-xl font-medium leading-[1.15] text-black transition group-hover:text-[#8232ff]">
                {post.title}
              </h3>
              <p className="mt-4 text-sm leading-[1.5] text-black/40">
                {post.body}
              </p>
            </a>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
