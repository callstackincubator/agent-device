import { DisplayHeading, Eyebrow, LeadText } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  inverse?: boolean;
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  inverse = false,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("mx-auto max-w-[1088px] text-center", className)}>
      <Eyebrow tone={inverse ? "light" : "dark"}>
        {eyebrow}
      </Eyebrow>
      <DisplayHeading
        tone={inverse ? "light" : "dark"}
        className="mt-2 text-[2.5rem] sm:text-[2.75rem]"
      >
        {title}
      </DisplayHeading>
      {description ? (
        <LeadText
          tone={inverse ? "light" : "dark"}
          className="mx-auto mt-4 max-w-[640px] text-[18px]"
        >
          {description}
        </LeadText>
      ) : null}
    </div>
  );
}
