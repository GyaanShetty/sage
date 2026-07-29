import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const maxDuration = 45;

/** Strip an HTML page down to readable text (best-effort). */
function readable(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** AI summary of a morning-block article. Tries to read the page; falls back to
 *  a headline-based summary when the source is paywalled or unreachable. */
export async function POST(req: Request) {
  const { title, link } = (await req.json()) as { title?: string; link?: string };
  if (!title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });

  const model = getModel("fast");
  if (!model) return NextResponse.json({ ok: false, error: "no model" }, { status: 400 });

  let body = "";
  if (link) {
    try {
      const res = await proxyFetch(link, {
        signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; SAGE/0.2)" },
      });
      if (res.ok) body = readable(await res.text()).slice(0, 4000);
    } catch { /* paywalled / blocked */ }
  }

  const { text } = await generateText({
    model,
    system: "You are SAGE, briefing Gyaan. Summarize the article in 3-4 crisp, information-dense sentences — the key facts and why they matter. If the body text is thin or paywalled, summarize from the headline and note it's a headline read. No preamble, no markdown.",
    prompt: `Headline: ${title}\n\nArticle text (may be partial/empty):\n${body || "(unavailable — paywalled or blocked)"}`,
  });

  return NextResponse.json({ ok: true, data: { summary: text.trim(), link } });
}
