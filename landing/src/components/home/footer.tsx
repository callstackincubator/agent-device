import Link from "next/link";

const footerGroups = [
  {
    title: "Agent Device",
    links: [
      { href: "https://github.com/callstackincubator/agent-device", label: "GitHub" },
      { href: "/agentic-qa", label: "Agentic QA" },
      { href: "/agentic-development", label: "Agentic Development" },
    ],
  },
  {
    title: "Documentation",
    links: [
      { href: "https://github.com/callstackincubator/agent-device", label: "Documentation" },
      { href: "https://github.com/callstackincubator/agent-device", label: "GitHub" },
    ],
  },
  {
    title: "Callstack",
    links: [
      { href: "https://www.callstack.com/open-source", label: "Open Source" },
      { href: "https://www.callstack.com/services", label: "Services" },
      { href: "https://www.callstack.com/case-studies", label: "Case Studies" },
      { href: "https://www.callstack.com/technologies/react-native", label: "Technology" },
    ],
  },
  {
    title: "Social",
    links: [
      { href: "https://x.com/callstackio", label: "X" },
      { href: "https://www.youtube.com/@callstackengineers", label: "YouTube" },
      { href: "https://www.linkedin.com/company/callstackio", label: "LinkedIn" },
      { href: "https://www.instagram.com/callstackio", label: "Instagram" },
      { href: "https://github.com/callstack", label: "GitHub" },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-black/10 bg-white px-5 py-20 sm:px-8 lg:px-16 lg:py-[100px]">
      <div className="mx-auto grid max-w-[1312px] gap-14 md:grid-cols-[1fr_2fr] lg:min-h-[130px]">
        <div>
          <Link href="https://www.callstack.com" className="font-display text-2xl font-semibold text-black">
            (callstack)
          </Link>
          <p className="mt-4 max-w-[220px] text-sm font-medium leading-[1.45] text-black/50">
            Mobile by Callstack.
            <br />
            AI Native Engineering.
            <br />
            Made for React Native.
          </p>
        </div>
        <nav
          aria-label="Footer navigation"
          className="grid gap-10 text-sm font-medium text-black/45 sm:grid-cols-2 lg:grid-cols-4 lg:gap-12"
        >
          {footerGroups.map((group) => (
            <div key={group.title}>
              <p className="font-medium text-black">{group.title}</p>
              <ul className="mt-4 grid gap-2">
                {group.links.map((link) => (
                  <li key={`${group.title}-${link.label}`}>
                    <Link className="transition hover:text-black" href={link.href}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}
