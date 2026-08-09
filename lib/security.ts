/**
 * Security headers, in one place.
 *
 * Every one of these is a browser-enforced restriction: the server asks, and
 * the browser refuses on its behalf. They cost nothing at runtime and close
 * whole categories of attack that application code cannot.
 *
 * The Content-Security-Policy is deliberately not maximal. A policy that
 * breaks the app gets deleted the first time something stops working, and a
 * deleted policy protects nothing — so this one blocks what actually matters
 * (foreign script origins, framing, form hijacking, plugin content) while
 * leaving the loopholes Next.js genuinely needs.
 */
export const CSP = [
  "default-src 'self'",

  // Next.js inlines its bootstrap and hydration payload, and the App Router
  // needs eval for its chunk loader in some paths. 'unsafe-inline' here is not
  // ideal; what it still buys is that no script from another origin can run,
  // which is the injection route that matters.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",

  // Article thumbnails, map tiles and avatars come from wherever the source
  // happens to host them. Restricting to a host list would silently break the
  // morning block the first time a publisher moved their CDN.
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "media-src 'self' https: data: blob:",

  // The browser talks to this origin and to Supabase; everything else is
  // called server-side, where CSP does not apply.
  "connect-src 'self' https: wss:",

  // Embedded players only.
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://open.spotify.com",

  // Nothing may frame SAGE. This is the clickjacking defence, and it is the
  // single most valuable line here.
  "frame-ancestors 'none'",

  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Content-Security-Policy", value: CSP },

  // Two years, subdomains included. Once seen, the browser refuses to speak
  // plain HTTP to this host at all — which removes the downgrade step that
  // most session-stealing on public wifi depends on.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },

  // Belt and braces with frame-ancestors, for anything that predates CSP.
  { key: "X-Frame-Options", value: "DENY" },

  // Stops a browser deciding an uploaded .txt is really JavaScript.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // A URL here can carry a note title or a search. Send the origin to other
  // sites, never the path.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  /**
   * Hardware, denied by default.
   *
   * Microphone and camera are allowed for this origin only, because dictation
   * and the screenshot capture need them. publickey-credentials-get is what
   * lets a passkey be used at all — omitting it silently disables biometric
   * sign-in, which is the sort of failure that gets diagnosed as "Face ID is
   * broken".
   */
  {
    key: "Permissions-Policy",
    value: [
      "microphone=(self)",
      "camera=(self)",
      "publickey-credentials-get=(self)",
      "geolocation=(self)",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "interest-cohort=()",
    ].join(", "),
  },

  // Isolate this origin's browsing context group from anything it opens.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/**
 * Is this request coming from SAGE's own pages?
 *
 * SameSite=Lax already stops a cross-site POST carrying the session cookie,
 * so this is the second lock rather than the first. It matters because Lax is
 * a browser policy: an old browser, a misconfigured proxy, or a future
 * relaxation of the rule would leave nothing behind it.
 *
 * A missing Origin is refused for state-changing methods. Browsers always send
 * it on those; a request without one is a script or a tool, and neither should
 * be mutating anything with a cookie it inherited.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = req.headers.get("host");
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Methods that change something, and therefore have to prove where they came from. */
export const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
