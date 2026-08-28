import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono, Orbitron } from "next/font/google";
import type { Viewport } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const disp = Space_Grotesk({ variable: "--font-disp", subsets: ["latin"], weight: ["300", "400", "500", "600"] });
const mono = JetBrains_Mono({ variable: "--font-mono-f", subsets: ["latin"], weight: ["300", "400", "500"] });
// The wordmark face. Squared-off and geometric — the look the block art was
// reaching for, except it is an actual typeface: it kerns, it scales, it stays
// readable at 11px, and it is self-hosted at build time like the other two.
const brand = Orbitron({ variable: "--font-brand", subsets: ["latin"], weight: ["500", "700", "900"] });

export const metadata: Metadata = {
  title: { default: `${APP_NAME} · Mission Control`, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: APP_NAME },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#070708",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/*
          Density, applied before the first paint.
          The preference lives in localStorage, which React cannot read during
          render without the server and client disagreeing — so setting it in
          an effect means one frame of the comfortable layout before it snaps
          to compact. That flash is exactly what a density setting is meant to
          avoid. Inline, synchronous, and silent if storage is unavailable.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              // Compact unless explicitly opted out of — the same default as
              // lib/density-pref. If these two ever disagree the page renders
              // one frame at the wrong density and snaps, which is precisely
              // what doing this inline is meant to prevent.
              "try{if(localStorage.getItem('sage-density')!=='comfortable')" +
              "document.documentElement.setAttribute('data-density','compact')}catch(e){}",
          }}
        />
      </head>
      <body className={`${disp.variable} ${mono.variable} ${brand.variable} antialiased`}>
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
