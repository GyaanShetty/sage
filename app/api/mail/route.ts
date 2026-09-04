import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { listGmail, getGmailMessage, createGmailDraft } from "@/infrastructure/integrations/google";
import { listOutlookMail, readOutlookMail, type OutlookMessage } from "@/infrastructure/integrations/outlook";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Outlook, normalised into the shape the mail view already reads.
 *
 * The normalising happens here rather than in the client on purpose: a second
 * message shape reaching the view means every feature — the list, the reader,
 * the summariser, the attachment strip — gets written twice, and the second
 * copy is the one that rots. One shape in, one set of behaviours.
 *
 * Graph gives no snippet separate from the body, so bodyPreview is the
 * snippet. Bodies arrive as HTML; they are stripped to text here because the
 * view renders bodies as text and never as markup — a mail body is untrusted
 * markup from anyone who knows your address.
 */
function fromOutlook(m: OutlookMessage, withBody = false) {
  const text = (m.body ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    id: m.id,
    // The view's `sender()` reads the `Name <address>` form, so it is
    // reassembled here rather than teaching the view a second convention.
    from: m.fromName && m.from ? `${m.fromName} <${m.from}>` : m.from || m.fromName,
    subject: m.subject,
    snippet: m.preview,
    date: m.receivedAt,
    unread: m.unread,
    webLink: m.webLink,
    ...(withBody ? { to: "", body: text || m.preview } : {}),
  };
}

/** Mailbox views, mapped to the Gmail queries behind them. */
const VIEWS: Record<string, string> = {
  unread: "is:unread in:inbox",
  inbox: "in:inbox",
  important: "is:important in:inbox newer_than:14d",
  starred: "is:starred",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const account = url.searchParams.get("account") === "outlook" ? "outlook" : "gmail";

  if (account === "outlook") {
    if (id) {
      const msg = await readOutlookMail(id);
      if (!msg) return NextResponse.json({ ok: false, error: "Outlook isn't connected, or that message is gone." }, { status: 404 });
      return NextResponse.json({ ok: true, data: fromOutlook(msg, true) });
    }

    const mail = await listOutlookMail(50);
    if (mail === null) {
      return NextResponse.json({ ok: false, error: "Outlook isn't connected — Settings → Connect Outlook." }, { status: 400 });
    }

    /*
     * Graph has no query language to hand a view to, so the views are applied
     * here. "important" and "starred" have no Outlook equivalent under
     * Mail.Read, so they fall back to the inbox rather than returning an empty
     * list that reads as "no important mail" when it means "not supported".
     */
    const view = url.searchParams.get("view") ?? "unread";
    const search = url.searchParams.get("q")?.trim().toLowerCase();
    let rows = mail;
    if (search) {
      rows = mail.filter((m) =>
        `${m.subject} ${m.fromName} ${m.from} ${m.preview}`.toLowerCase().includes(search));
    } else if (view === "unread") {
      rows = mail.filter((m) => m.unread);
    }
    return NextResponse.json({ ok: true, data: { query: search || view, messages: rows.map((m) => fromOutlook(m)) } });
  }

  // One message, in full.
  if (id) {
    const msg = await getGmailMessage(id);
    if (!msg) return NextResponse.json({ ok: false, error: "Gmail isn't connected, or that message is gone." }, { status: 404 });
    return NextResponse.json({ ok: true, data: msg });
  }

  const view = url.searchParams.get("view") ?? "unread";
  const search = url.searchParams.get("q")?.trim();
  // A typed search beats the view; an empty one falls back rather than
  // querying Gmail for the empty string, which returns everything.
  const query = search || VIEWS[view] || VIEWS.unread;

  const messages = await listGmail(query, 30);
  if (messages === null) {
    return NextResponse.json({ ok: false, error: "Gmail isn't connected — Settings → Connect Google." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, data: { query, messages } });
}

const summarySchema = z.object({
  gist: z.string().describe("What this email actually says, in 1-2 sentences"),
  asks: z.array(z.string()).describe("What it wants from the reader. Empty if it wants nothing."),
  deadline: z.string().describe("Any date or time limit mentioned, verbatim. Empty string if none."),
  urgency: z.enum(["now", "this-week", "whenever", "ignore"]),
  suggestedReply: z.string().describe("A short reply he could send, or an empty string if none is needed"),
});

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: "summarise" | "draft";
    account?: "gmail" | "outlook";
    id?: string;
    to?: string; subject?: string; text?: string;
  };

  if (body.action === "draft") {
    if (!body.to || !body.subject) {
      return NextResponse.json({ ok: false, error: "to and subject required" }, { status: 400 });
    }
    // A draft, never a send. Nothing leaves the account without you pressing
    // Send in Gmail — the scope is deliberately compose-only.
    const ok = await createGmailDraft(body.to, body.subject, body.text ?? "");
    if (ok === null) return NextResponse.json({ ok: false, error: "Gmail isn't connected." }, { status: 400 });
    return NextResponse.json({ ok, ...(ok ? {} : { error: "Couldn't create that draft." }) });
  }

  if (!body.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  /*
   * Summarising is the reason to read mail inside SAGE at all, so it works on
   * both accounts. Only drafting is Gmail-only, and that is a scope limit
   * rather than a decision: Outlook is connected with Mail.Read.
   */
  const msg = body.account === "outlook"
    ? await readOutlookMail(body.id).then((m) => (m ? fromOutlook(m, true) : null))
    : await getGmailMessage(body.id);
  if (!msg) return NextResponse.json({ ok: false, error: "Couldn't read that message." }, { status: 404 });

  const model = getModel("fast");
  if (!model) return NextResponse.json({ ok: false, error: "No model available right now." }, { status: 503 });

  try {
    const { object } = await generateObject({
      model,
      schema: summarySchema,
      system:
        "You are SAGE, reading Gyaan's email so he does not have to. " +
        "Say what it actually says and what it wants. Marketing dressed as a personal note is 'ignore'. " +
        "Never invent a deadline that is not in the text. Be brief and unsentimental.",
      prompt: `From: ${msg.from}\nSubject: ${msg.subject}\nDate: ${msg.date}\n\n${(msg.body || msg.snippet).slice(0, 6000)}`,
    });
    return NextResponse.json({ ok: true, data: object });
  } catch {
    return NextResponse.json({ ok: false, error: "The model couldn't read that one." }, { status: 502 });
  }
}
