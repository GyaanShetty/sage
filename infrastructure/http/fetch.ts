import { fetch as undiciFetch, EnvHttpProxyAgent } from "undici";

const agent = process.env.HTTPS_PROXY || process.env.https_proxy ? new EnvHttpProxyAgent() : null;

/** Proxy-aware fetch for server-side outbound requests (no-op wrapper in prod). */
export const proxyFetch: typeof globalThis.fetch = agent
  ? ((((url: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
      undiciFetch(url, { ...init, dispatcher: agent })) as unknown) as typeof globalThis.fetch)
  : globalThis.fetch;

/** Basic SSRF guard for user-supplied URLs. */
export function assertPublicHttpUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs");
  const host = url.hostname;
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1"
  ) {
    throw new Error("Private addresses are not allowed");
  }
  return url;
}
