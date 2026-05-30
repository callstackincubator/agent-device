type HeroBackdropProps = {
  focus?: "center" | "high";
};

export function HeroBackdrop({ focus = "center" }: HeroBackdropProps) {
  const radial = focus === "high"
    ? "bg-[radial-gradient(circle_at_50%_40%,rgba(130,50,255,0.52),rgba(0,0,0,0)_34%),linear-gradient(to_bottom,rgba(0,0,0,0)_58%,#000_100%)]"
    : "bg-[radial-gradient(circle_at_50%_46%,rgba(130,50,255,0.52),rgba(0,0,0,0)_33%),linear-gradient(to_bottom,rgba(0,0,0,0)_55%,#000_100%)]";

  return (
    <>
      <div className="absolute inset-0 bg-[url('/figma/hero-shader.webp')] bg-cover bg-center opacity-20" />
      <div className="absolute inset-0 bg-[#8232ff] mix-blend-color" />
      <div className={radial} />
    </>
  );
}
