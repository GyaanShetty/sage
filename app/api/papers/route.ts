import { NextResponse } from "next/server";
import { searchPapers, getPaper, cite } from "@/infrastructure/integrations/arxiv";
import { ingestPdf } from "@/core/knowledge/ingest";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Search arXiv. Free, no key — see infrastructure/integrations/arxiv.ts. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ ok: true, data: { papers: [] } });

  const papers = await searchPapers(q, {
    limit: Number(url.searchParams.get("limit")) || 12,
    sortBy: url.searchParams.get("sort") === "recent" ? "recent" : "relevance",
  });

  if (papers === null) return NextResponse.json({ ok: false, error: "arXiv didn't answer just now." }, { status: 502 });
  return NextResponse.json({ ok: true, data: { papers } });
}

/**
 * Save a paper into the knowledge base.
 *
 * The whole PDF, not the abstract: an abstract in the knowledge base answers
 * questions the abstract already answered, which is the least useful half of
 * having the paper. It goes through the same ingest path as an uploaded PDF,
 * so it is chunked, embedded and searchable alongside everything else.
 */
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const paper = await getPaper(id);
  if (!paper) return NextResponse.json({ ok: false, error: "No paper with that id." }, { status: 404 });

  try {
    const res = await proxyFetch(paper.pdfUrl, {
      headers: { "user-agent": "SAGE", accept: "application/pdf" },
      redirect: "follow",
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) throw new Error(`arXiv returned ${res.status} for the PDF`);

    const buffer = Buffer.from(await res.arrayBuffer());
    // Named by title rather than id: a knowledge base listing "2401.01234.pdf"
    // is a filing cabinet you have to open to use.
    const name = `${paper.title.replace(/[^\w\s-]/g, "").slice(0, 80)}.pdf`;
    const source = await ingestPdf(buffer, name);

    return NextResponse.json({ ok: true, data: { source, citation: cite(paper), paper } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
