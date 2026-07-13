/**
 * Runs once at server boot (Next.js instrumentation hook).
 * In proxied environments (HTTPS_PROXY set, e.g. sandboxed dev containers),
 * Node's fetch ignores proxy env vars — route undici through the proxy so
 * supabase-js and other fetch-based clients work. No-op in production.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
    const { setGlobalDispatcher, EnvHttpProxyAgent } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
}
