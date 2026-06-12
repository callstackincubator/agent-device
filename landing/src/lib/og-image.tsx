import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

type OgImageOptions = {
  eyebrow: string;
  title: string;
  description: string;
};

export const ogImageSize = {
  width: 1200,
  height: 630,
};

export const ogImageContentType = "image/png";

const fontsDirectory = join(process.cwd(), "src", "app", "fonts");

async function getOgFonts() {
  const [regular, semiBold] = await Promise.all([
    readFile(join(fontsDirectory, "AllianceNo2-Regular.ttf")),
    readFile(join(fontsDirectory, "AllianceNo2-SemiBold.ttf")),
  ]);

  return [
    {
      data: regular,
      name: "Alliance No.2",
      style: "normal" as const,
      weight: 400 as const,
    },
    {
      data: semiBold,
      name: "Alliance No.2",
      style: "normal" as const,
      weight: 600 as const,
    },
  ];
}

export async function createOgImage({ eyebrow, title, description }: OgImageOptions) {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#050009",
          color: "white",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(130, 50, 255, 0.85), rgba(130, 50, 255, 0.24) 30%, rgba(0, 0, 0, 0) 62%)",
            height: 900,
            left: 120,
            position: "absolute",
            top: -120,
            width: 960,
          }}
        />
        <div
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            inset: 0,
            opacity: 0.7,
            position: "absolute",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "72px",
            position: "relative",
            width: "100%",
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.52)",
              fontFamily: "Alliance No.2",
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 0,
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              fontSize: 84,
              fontFamily: "Alliance No.2",
              fontWeight: 600,
              letterSpacing: 0,
              lineHeight: 0.98,
              marginTop: 28,
              maxWidth: 960,
            }}
          >
            {title}
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.72)",
              fontFamily: "Alliance No.2",
              fontSize: 30,
              lineHeight: 1.35,
              marginTop: 36,
              maxWidth: 860,
            }}
          >
            {description}
          </div>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              gap: 18,
              marginTop: 64,
            }}
          >
            <div
              style={{
                background: "#ffffff",
                borderRadius: 4,
                color: "#000000",
                fontFamily: "Alliance No.2",
                fontSize: 24,
                fontWeight: 700,
                padding: "18px 28px",
              }}
            >
              Agent Device
            </div>
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.28)",
                borderRadius: 4,
                color: "rgba(255,255,255,0.84)",
                fontFamily: "Alliance No.2",
                fontSize: 24,
                fontWeight: 600,
                padding: "18px 28px",
              }}
            >
              agent-device.dev
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...ogImageSize,
      fonts: await getOgFonts(),
    },
  );
}
