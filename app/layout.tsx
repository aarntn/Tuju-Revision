import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./tokens.css";
import "./wireframe.css";
import "./journey.css";
import "./landing.css";
import "./map-first.css";
import "./presentation.css";
import "./cruise.css";
import "./road-ui.css";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "LaPan",
  description: "Plan your balik kampung drive from Kuala Lumpur to Ipoh.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true },
  icons: { apple: "/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#F2F3F7", viewportFit: "cover" };

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
// Number plates and codes only.
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geist.variable} ${geistMono.variable}`}><body>
    <AppShell />
    <div className="presentation-stage">
      <div className="presentation-phone" data-testid="presentation-phone">
        <div className="presentation-screen" data-testid="presentation-screen">{children}</div>
      </div>
    </div>
  </body></html>;
}
