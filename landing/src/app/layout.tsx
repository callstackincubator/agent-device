import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { JsonLd } from "@/components/json-ld";
import { createBaseJsonLd, createPageMetadata, seo } from "@/lib/seo";

import "./globals.css";

const alliance = localFont({
  src: [
    {
      path: "./fonts/AllianceNo2-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/AllianceNo2-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/AllianceNo2-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/AllianceNo2-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-alliance-no2",
  display: "swap",
});

const switzer = localFont({
  src: "./fonts/Switzer-Variable.woff2",
  variable: "--font-switzer",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  ...createPageMetadata(seo.pages.home),
  metadataBase: new URL(seo.siteUrl),
  applicationName: seo.siteName,
  appleWebApp: {
    capable: true,
    title: seo.siteName,
  },
  category: "developer tools",
  creator: "Callstack",
  authors: [{ name: "Callstack", url: seo.organization.url }],
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
  keywords: [
    "agent-device",
    "AI agents",
    "mobile testing",
    "agentic QA",
    "React Native",
    "iOS automation",
    "Android automation",
  ],
  manifest: "/manifest.webmanifest",
  publisher: "Callstack",
  referrer: "origin-when-cross-origin",
  robots: {
    follow: true,
    index: true,
    googleBot: {
      follow: true,
      index: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  title: {
    default: seo.pages.home.title,
    template: `%s | ${seo.siteName}`,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: "#8232ff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${alliance.variable} ${switzer.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-white text-black">
        <JsonLd data={createBaseJsonLd()} />
        {children}
      </body>
    </html>
  );
}
