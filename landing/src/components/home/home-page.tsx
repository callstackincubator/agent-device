import { CloudOpenSection } from "@/components/home/cloud-open-section";
import { CtaSection } from "@/components/home/cta-section";
import { Footer } from "@/components/home/footer";
import { Hero } from "@/components/home/hero";
import { Insights } from "@/components/home/insights";
import { Solutions } from "@/components/home/solutions";
import { ToolkitLanes } from "@/components/home/toolkit-lanes";
import { UseCases } from "@/components/home/use-cases";
import { WhyCallstack } from "@/components/home/why-callstack";
import { StackSupportSection } from "@/components/stack-support-section";

export function HomePage() {
  return (
    <>
      <Hero />
      <Solutions />
      <ToolkitLanes />
      <UseCases />
      <CloudOpenSection />
      <WhyCallstack />
      <StackSupportSection />
      <CtaSection />
      <Insights />
      <Footer />
    </>
  );
}
