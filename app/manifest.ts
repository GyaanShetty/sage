import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} · Mission Control`,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    start_url: "/dashboard",
    display: "standalone",
    orientation: "any",
    background_color: "#070708",
    theme_color: "#070708",
    share_target: {
      action: "/read",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
    /*
     * The mark is vector, so one file covers every size — "any" tells the
     * platform to scale it rather than pick the nearest raster. The PNGs stay
     * listed after it as the fallback for older Android launchers, which
     * ignore SVG icons entirely.
     */
    icons: [
      { src: "/sage-mark-v3.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192-v3.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512-v3.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-v3.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
