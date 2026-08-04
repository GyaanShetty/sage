import type { NextConfig } from "next";

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
};

export default nextConfig;
