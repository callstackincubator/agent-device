import Link from "next/link";

const links = ["Agentic QA", "Agentic Development", "GitHub"];

export function Footer() {
  return (
    <footer className="border-t border-black/10 bg-white px-5 py-16 sm:px-8 lg:px-16">
      <div className="mx-auto flex max-w-[1312px] flex-col justify-between gap-10 md:flex-row">
        <div>
          <Link href="/" className="font-display text-2xl font-semibold text-black">
            Agent Device
          </Link>
          <p className="mt-3 max-w-[420px] leading-[1.5] text-black/50">
            Mobile app automation for agents, built by Callstack.
          </p>
        </div>
        <nav className="flex flex-wrap gap-6 text-sm font-medium text-black/60">
          {links.map((link) => (
            <Link
              href={link === "GitHub" ? "https://github.com/callstackincubator/agent-device" : `/${link.toLowerCase().replaceAll(" ", "-")}`}
              key={link}
            >
              {link}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
