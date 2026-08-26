import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./lib/security";

const nextConfig: NextConfig = {
  /**
   * pdf-parse and its pdfjs-dist dependency must not be bundled.
   *
   * pdfjs loads its worker by resolving a sibling file (pdf.worker.mjs) at
   * runtime. Webpack rewrites the import but cannot follow it, so on Vercel
   * the lookup landed on a path that does not exist:
   *   Cannot find module '/var/task/.next/server/chunks/pdf.worker.mjs'
   * and every PDF upload failed. Left external, the package keeps its own
   * directory layout in node_modules and finds its worker where it expects it.
   *
   * jsdom is external for the same class of reason — it resolves files
   * relative to its own package at runtime.
   */
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "jsdom"],

  /**
   * Ship the pdfjs worker, which nothing can infer.
   *
   * Marking the package external fixed half of this — the lookup moved from
   * `.next/server/chunks/pdf.worker.mjs` to the correct
   * `node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs` — and then failed
   * there instead, because the file was never uploaded.
   *
   * Vercel traces a function's dependencies by following imports it can see
   * statically. pdfjs resolves its worker by building a path at runtime, so
   * there is no import to follow and the tracer concludes the file is unused.
   * It is only unused right up until someone uploads a PDF, at which point
   * pdf.js tries a "fake worker" fallback, that import fails too, and the
   * whole thing surfaces as `Setting up fake worker failed`.
   *
   * Listing it explicitly is the only way to tell the tracer about a file no
   * static analysis can find.
   */
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/build/pdf.worker.mjs",
      "./node_modules/pdf-parse/dist/worker/pdf.worker.mjs",
    ],
  },

  /**
   * Applied to every response, including static assets and error pages.
   *
   * Set here rather than in middleware so they hold even on paths the
   * middleware skips — a security header that is missing from exactly the
   * routes nobody thought about is the usual way this goes wrong.
   */
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },

  // The server's name and version is free reconnaissance.
  poweredByHeader: false,
};

export default nextConfig;
