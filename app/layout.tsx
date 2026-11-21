import type { Metadata, Viewport } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/barlow-condensed/700-italic.css";
import "@fontsource/barlow-condensed/800-italic.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "APT Stock Portal", template: "%s · APT Stock Portal" },
  description: "Axis Plastics Transition — daily finished-goods stock availability.",
  icons: { icon: "/apt-mark.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#17191e" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
