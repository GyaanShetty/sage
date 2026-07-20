import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { Providers } from "@/components/providers";
import "./globals.css";

const disp = Space_Grotesk({ variable: "--font-disp", subsets: ["latin"], weight: ["300", "400", "500", "600"] });
const mono = JetBrains_Mono({ variable: "--font-mono-f", subsets: ["latin"], weight: ["300", "400", "500"] });

export const metadata: Metadata = {
  title: { default: `${APP_NAME} · COMMAND`, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${disp.variable} ${mono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
