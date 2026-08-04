import { embedMany } from "ai";
import { google } from "@ai-sdk/google";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { proxyFetch, assertPublicHttpUrl } from "@/infrastructure/http/fetch";
import { EMBEDDING_DIM, toVectorLiteral } from "@/infrastructure/embeddings";
import { chunkText, type TextChunk } from "./chunking";

async function embedChunks(chunks: TextChunk[]): Promise<(number[] | null)[]> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) return chunks.map(() => null);
  const out: (number[] | null)[] = [];
  // Gemini free tier: batch conservatively
  for (let i = 0; i < chunks.length; i += 50) {
    const batch = chunks.slice(i, i + 50);
    const { embeddings } = await embedMany({
      model: google.textEmbedding("gemini-embedding-001"),
      values: batch.map((c) => c.content),
      providerOptions: { google: { outputDimensionality: EMBEDDING_DIM } },
    });
    out.push(...embeddings);
  }
  return out;
}

async function storeSource(
  kind: string,
  title: string,
  url: string | null,
  chunks: TextChunk[],
): Promise<{ sourceId: string; chunkCount: number }> {
  await ensureDefaultUser();
  const sourceId = crypto.randomUUID();
  const { error: sourceError } = await db.from("Source").insert({
    id: sourceId,
    userId: DEFAULT_USER_ID,
    kind,
    title,
    url,
    status: "processing",
    metadata: { chunkCount: chunks.length },
  });
  if (sourceError) throw new Error(sourceError.message);

  try {
    const embeddings = await embedChunks(chunks);
    const rows = chunks.map((chunk, i) => ({
      id: crypto.randomUUID(),
      sourceId,
      userId: DEFAULT_USER_ID,
      content: chunk.content,
      position: chunk.position,
      metadata: chunk.metadata,
      ...(embeddings[i] ? { embedding: toVectorLiteral(embeddings[i]!) } : {}),
    }));
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await db.from("Chunk").insert(rows.slice(i, i + 50));
      if (error) throw new Error(error.message);
    }
    await db.from("Source").update({ status: "ready" }).eq("id", sourceId);
    return { sourceId, chunkCount: chunks.length };
  } catch (err) {
    await db
      .from("Source")
      .update({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .eq("id", sourceId);
    throw err;
  }
}

export async function ingestUrl(rawUrl: string) {
  const url = assertPublicHttpUrl(rawUrl);

  // A self-identifying bot user-agent gets 403'd by Cloudflare and most CDNs,
  // which is what "Fetch failed: 403" was: not a broken link, a refused one.
  // These are the headers a browser actually sends; without the full set the
  // request still reads as automated.
  const res = await proxyFetch(url.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-GB,en;q=0.9",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "upgrade-insecure-requests": "1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    // Say which kind of failure it is; "403" alone reads like a bug in SAGE
    // rather than a site that will not serve anything but a real browser.
    if (res.status === 403 || res.status === 401) {
      throw new Error(
        `${url.hostname} refused the request (${res.status}) — it blocks automated readers. Try saving the page as a PDF and uploading that.`,
      );
    }
    if (res.status === 404) throw new Error(`${url.hostname} returned 404 — check the link.`);
    throw new Error(`Fetch failed: ${res.status}`);
  }
  const html = await res.text();

  const { JSDOM } = await import("jsdom");
  const { Readability } = await import("@mozilla/readability");
  const dom = new JSDOM(html, { url: url.toString() });
  const article = new Readability(dom.window.document).parse();
  const title = article?.title || url.hostname;
  const text = article?.textContent?.trim();
  if (!text || text.length < 200) throw new Error("Could not extract readable content");

  const chunks = chunkText(text, { source: "url", href: url.toString() });
  return storeSource("url", title, url.toString(), chunks);
}

export async function ingestPdf(buffer: Buffer, filename: string) {
  // Must run BEFORE pdf-parse is imported: pdfjs reaches for DOMMatrix while
  // its module is still evaluating, so installing the stubs afterwards is too
  // late and the import throws.
  const { installPdfGlobals } = await import("@/infrastructure/pdf/node-globals");
  installPdfGlobals();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const parsed = await parser.getText();
  const text = parsed.text?.trim();
  if (!text || text.length < 100) throw new Error("No extractable text in PDF");
  const chunks = chunkText(text, { source: "pdf", pages: parsed.pages?.length });
  return storeSource("pdf", filename.replace(/\.pdf$/i, ""), null, chunks);
}
