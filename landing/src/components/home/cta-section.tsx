import { CtaBand } from "@/components/ui/cta-band";

export function CtaSection() {
  return (
    <CtaBand
      id="get-started"
      eyebrow="Agent Device"
      title="Give your agent control over mobile apps."
      body="Give your agents real mobile reach. Install builds, drive the UI, debug crashes, capture proof. Local on your machine, repeatable in CI and sandboxes."
      actions={[
        {
          href: "https://github.com/callstackincubator/agent-device",
          label: "Open on GitHub",
        },
        {
          href: "https://www.callstack.com/contact?message=%22I%20want%20to%20chat%20about%20agent-device%22",
          label: "Get a Demo",
          variant: "secondary",
        },
      ]}
      size="tall"
    />
  );
}
