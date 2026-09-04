"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ExternalLink, Loader2, Mail, Paperclip, PenLine, Search, Sparkles, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/config";
import "@/features/dashboard/command.css";
import "./mail.css";

/**
 * Mail, inside SAGE.
 *
 * Reading it here rather than in Gmail is only worth it if SAGE adds
 * something Gmail does not: what the message actually says, what it wants from
 * you, and whether it deserves a reply today. So the summary is the point and
 * the raw body is underneath it.
 *
 * Two deliberate limits. Bodies are shown as text, never rendered as HTML —
 * a mail body is untrusted markup from anyone who knows your address. And
 * replies create a Gmail DRAFT rather than sending: the OAuth scope is
 * compose-only, so nothing can leave your account without you pressing Send.
 */

interface Row {
  id?: string; from: string; subject: string; snippet: string;
  date: string; unread: boolean; important?: boolean;
  /** Outlook's own deep link. Gmail's is built from the id instead. */
  webLink?: string;
}
interface Attachment {
  attachmentId: string; filename: string; mimeType: string;
  size: number; inline: boolean; isImage: boolean;
}
interface Full extends Row { to: string; body: string; attachments?: Attachment[] }

const kb = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Files on a message, shown rather than mentioned.
 *
 * Images are the point here: an attached photo or screenshot is the content of
 * the mail, and being told "1 attachment" while having to open Gmail to see it
 * makes the mailbox a notification rather than a place to read. Inline images —
 * signature logos, tracking pixels — are separated out, because six 2 KB
 * images will otherwise bury the one PDF that matters.
 */
function Attachments({ messageId, files }: { messageId: string; files: Attachment[] }) {
  const real = files.filter((f) => !f.inline || f.size > 40_000);
  if (real.length === 0) return null;

  const src = (f: Attachment, download = false) =>
    `/api/mail/attachment?id=${encodeURIComponent(messageId)}&att=${encodeURIComponent(f.attachmentId)}${download ? "&download=1" : ""}`;

  return (
    <div className="ml-atts">
      <span className="ml-attlbl">{real.length} ATTACHED</span>
      <div className="ml-attgrid">
        {real.map((f) => (
          <a key={f.attachmentId} href={src(f)} target="_blank" rel="noreferrer" className="ml-att" title={`${f.filename} · ${kb(f.size)}`}>
            {f.isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src(f)} alt={f.filename} className="ml-attimg" loading="lazy" />
            ) : (
              <span className="ml-attico"><Paperclip className="size-4" /></span>
            )}
            <span className="ml-attname">{f.filename}</span>
            <span className="ml-attsize">{kb(f.size)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
interface Summary {
  gist: string; asks: string[]; deadline: string;
  urgency: "now" | "this-week" | "whenever" | "ignore";
  suggestedReply: string;
}

/**
 * The two mailboxes, kept separate rather than merged.
 *
 * A merged list has to explain, on every row, which account a message came
 * from — and the two accounts mean different things to him: one is personal,
 * one is university. Two tabs is one extra click and no ambiguity.
 */
const ACCOUNTS = [
  { key: "gmail", label: "GMAIL" },
  { key: "outlook", label: "OUTLOOK" },
] as const;
type Account = (typeof ACCOUNTS)[number]["key"];

const VIEWS = [
  { key: "unread", label: "UNREAD" },
  { key: "inbox", label: "INBOX" },
  { key: "important", label: "IMPORTANT" },
  { key: "starred", label: "STARRED" },
];

const URGENCY: Record<Summary["urgency"], { label: string; cls: string }> = {
  now: { label: "NEEDS YOU NOW", cls: "u-now" },
  "this-week": { label: "THIS WEEK", cls: "u-week" },
  whenever: { label: "WHENEVER", cls: "u-when" },
  ignore: { label: "IGNORABLE", cls: "u-ignore" },
};

/** "Priya Sharma <priya@x.com>" → "Priya Sharma" */
function sender(raw: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(raw);
  return (m?.[1] ?? raw.replace(/[<>]/g, "")).trim();
}
function address(raw: string): string {
  return /<([^>]+)>/.exec(raw)?.[1] ?? raw.trim();
}

export function MailView() {
  const [account, setAccount] = useState<Account>("gmail");
  const [view, setView] = useState("unread");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [full, setFull] = useState<Full | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summarising, setSummarising] = useState(false);
  const [reply, setReply] = useState("");
  const [drafted, setDrafted] = useState<"idle" | "saving" | "done" | "error">("idle");

  const load = useCallback(async (acct: Account, v: string, search: string) => {
    setRows(null); setErr(null); setOpenId(null); setFull(null);
    const params = search.trim()
      ? `q=${encodeURIComponent(search.trim())}&view=${v}`
      : `view=${v}`;
    const j = await fetch(`/api/mail?${params}&account=${acct}`).then((r) => r.json()).catch(() => null);
    if (!j?.ok) {
      setErr(j?.error ?? `Couldn't reach ${acct === "outlook" ? "Outlook" : "Gmail"}.`);
      setRows([]);
      return;
    }
    setRows(j.data.messages as Row[]);
  }, []);
  useEffect(() => { void load(account, view, q); /* eslint-disable-next-line */ }, [account, view]);

  const open = async (id?: string) => {
    if (!id) return;
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id); setFull(null); setSummary(null); setReply(""); setDrafted("idle");
    const j = await fetch(`/api/mail?id=${encodeURIComponent(id)}&account=${account}`).then((r) => r.json()).catch(() => null);
    if (j?.ok) setFull(j.data as Full);
  };

  const summarise = async (id: string) => {
    setSummarising(true);
    const j = await fetch("/api/mail", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "summarise", id, account }),
    }).then((r) => r.json()).catch(() => null);
    setSummarising(false);
    if (j?.ok) {
      setSummary(j.data as Summary);
      if (!reply) setReply((j.data as Summary).suggestedReply ?? "");
    }
  };

  const draft = async () => {
    if (!full || !reply.trim()) return;
    setDrafted("saving");
    const j = await fetch("/api/mail", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "draft",
        to: address(full.from),
        subject: full.subject.startsWith("Re:") ? full.subject : `Re: ${full.subject}`,
        text: reply,
      }),
    }).then((r) => r.json()).catch(() => null);
    setDrafted(j?.ok ? "done" : "error");
  };

  return (
    <div className="ml-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}>
          <span className="sn"><Mail className="size-3.5" /></span>
          <h2>Mail</h2><span className="line" />
          {rows && <span className="tag">{rows.filter((r) => r.unread).length} UNREAD</span>}
        </div>
      </div>

      <div className="ml-bar">
        <div className="ml-views ml-accts">
          {ACCOUNTS.map((a) => (
            <button
              key={a.key}
              onClick={() => { setQ(""); setView("unread"); setAccount(a.key); }}
              className={cn("ml-view", account === a.key && "on")}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="ml-views">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => { setQ(""); setView(v.key); }}
              className={cn("ml-view", view === v.key && !q && "on")}
            >
              {v.label}
            </button>
          ))}
        </div>
        <form className="ml-search" onSubmit={(e) => { e.preventDefault(); void load(account, view, q); }}>
          <Search className="size-3.5 shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={account === "outlook"
              ? "Search subject, sender and preview…"
              : "Gmail search — from:x, has:attachment, newer_than:7d…"}
          />
        </form>
      </div>

      {err && (
        <div className="ml-empty">
          <AlertTriangle className="size-4" /> {err}
        </div>
      )}
      {!rows && !err && <p className="ml-dim"><Loader2 className="inline size-3 animate-spin" /> opening the mailbox…</p>}
      {rows && rows.length === 0 && !err && <div className="ml-empty">Nothing here.</div>}

      <div className="ml-list">
        {(rows ?? []).map((r) => {
          const isOpen = openId === r.id;
          return (
            <div key={r.id} className={cn("ml-item", r.unread && "unread", isOpen && "open")}>
              <button className="ml-row" onClick={() => void open(r.id)}>
                <span className="ml-from">{sender(r.from)}</span>
                <span className="ml-subj">{r.subject || "(no subject)"}</span>
                <span className="ml-snip">{r.snippet}</span>
                <span className="ml-date">
                  {r.date ? fmt(r.date, { day: "2-digit", month: "short" }) : ""}
                </span>
              </button>

              {isOpen && (
                <div className="ml-body">
                  {!full && <p className="ml-dim"><Loader2 className="inline size-3 animate-spin" /> loading…</p>}

                  {full && (
                    <>
                      <div className="ml-actions">
                        <button className="ml-btn" onClick={() => void summarise(full.id as string)} disabled={summarising || !!summary}>
                          {summarising ? <><Loader2 className="size-3 animate-spin" /> READING</>
                            : summary ? <><Check className="size-3" /> SUMMARISED</>
                            : <><Sparkles className="size-3" /> WHAT DOES IT SAY?</>}
                        </button>
                        <a
                          className="ml-btn"
                          href={account === "outlook"
                            ? (full.webLink ?? "https://outlook.office.com/mail/")
                            : `https://mail.google.com/mail/u/0/#inbox/${full.id}`}
                          target="_blank" rel="noreferrer"
                        >
                          <ExternalLink className="size-3" /> OPEN IN {account === "outlook" ? "OUTLOOK" : "GMAIL"}
                        </a>
                      </div>

                      {summary && (
                        <div className="ml-summary">
                          <span className={cn("ml-urg", URGENCY[summary.urgency].cls)}>
                            {URGENCY[summary.urgency].label}
                          </span>
                          <p className="ml-gist">{summary.gist}</p>
                          {summary.asks.length > 0 && (
                            <ul className="ml-asks">
                              {summary.asks.map((a, i) => <li key={i}>{a}</li>)}
                            </ul>
                          )}
                          {summary.deadline && <p className="ml-deadline">Deadline: {summary.deadline}</p>}
                        </div>
                      )}

                      {/* Plain text, deliberately. A mail body is untrusted
                          markup from anyone who knows your address. */}
                      <pre className="ml-raw">{full.body || full.snippet}</pre>

                      {full.attachments?.length ? (
                        <Attachments messageId={full.id as string} files={full.attachments} />
                      ) : null}

                      {/*
                        Stated, not hidden. SAGE holds Mail.Read on Outlook, so
                        drafting genuinely cannot work — and a compose box that
                        silently disappears on one account reads as a bug,
                        while one that appears and fails is worse.
                      */}
                      {account === "outlook" ? (
                        <div className="ml-noreply">
                          Read-only on Outlook — SAGE has <code>Mail.Read</code> only.
                          Reply in Outlook, or ask me to widen the permission.
                        </div>
                      ) : (
                      <div className="ml-reply">
                        <textarea
                          value={reply}
                          onChange={(e) => { setReply(e.target.value); setDrafted("idle"); }}
                          placeholder="Reply… SAGE saves it as a Gmail draft — nothing sends from here."
                          rows={3}
                        />
                        <button className="ml-btn primary" onClick={draft} disabled={!reply.trim() || drafted === "saving" || drafted === "done"}>
                          {drafted === "saving" ? <><Loader2 className="size-3 animate-spin" /> SAVING</>
                            : drafted === "done" ? <><Check className="size-3" /> DRAFT IN GMAIL</>
                            : drafted === "error" ? <><PenLine className="size-3" /> RETRY</>
                            : <><PenLine className="size-3" /> SAVE DRAFT</>}
                        </button>
                      </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
