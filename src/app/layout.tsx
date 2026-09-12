import type { Metadata, Viewport } from "next";
// Self-hosted: next/font/google crashes Turbopack on Windows ARM64, and nothing loads from Google at runtime.
import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";

export const viewport: Viewport = { themeColor: "#201E1D" };

export const metadata: Metadata = {
  title: { default: "Vantage", template: "%s · Vantage" },
  description: "Lead qualification for your Google Local Ads calls, sorted into your Nexus Portal pipeline.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
