"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, FileText, Image as ImageIcon, Film, Loader2, Paperclip,
  Plus, Send, Trash2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "./research.css";

/**
 * A workspace: a conversation with files in it.
 *
 * Uploads go straight from the browser to storage using a signed URL, never
 * through an API route — a serverless function body caps out around 4.5MB,
 * which rules out anything worth calling a large file. The ceiling here is the
 * storage quota instead.
 *
 * What SAGE can and cannot read is stated on the file itself rather than
 * discovered when an answer turns out to be vague. A photo it looks at; a PDF
 * it reads; a video it stores and says so.
 */

interface Attachment {
  id: string; name: string; mime: string; size: number;
  note?: string | null; hasText?: boolean; url?: string | null;
}
interface Msg { id: string; role: "user" | "assistant"; content: string; at: string }
interface Thread { id: string; title: string; attachments: Attachment[]; updatedAt: string }

const kb = (n: number) =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return Film;
  return FileText;
}

export function ResearchView() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const j = await fetch("/api/research/thread").then((r) => r.json()).catch(() => null);
    if (j?.ok) {
      setThreads(j.data.threads);
      setId((cur) => cur ?? j.data.threads[0]?.id ?? null);
    }
  }, []);
  useEffect(() => { void loadThreads(); }, [loadThreads]);

  const loadThread = useCallback(async (threadId: string) => {
    const j = await fetch(`/api/research/thread?id=${threadId}`).then((r) => r.json()).catch(() => null);
    if (j?.ok) { setThread(j.data.thread); setMessages(j.data.messages); }
  }, []);
  useEffect(() => { if (id) void loadThread(id); }, [id, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  const newThread = async () => {
    const j = await fetch("/api/research/thread", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Untitled" }),
    }).then((r) => r.json()).catch(() => null);
    if (j?.ok) { setId(j.data.thread.id); setMessages([]); void loadThreads(); }
  };

  /**
   * Upload: sign, PUT straight to storage, then register.
   *
   * Sequential rather than parallel — a phone uploading six files at once on a
   * shared connection finishes all of them slowly and none of them early.
   */
  const upload = useCallback(async (files: FileList | File[]) => {
    let threadId = id;
    if (!threadId) {
      const j = await fetch("/api/research/thread", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Untitled" }),
      }).then((r) => r.json()).catch(() => null);
      if (!j?.ok) { setError("Couldn't start a workspace."); return; }
      threadId = j.data.thread.id as string;
      setId(threadId);
    }

    for (const file of Array.from(files)) {
      setUploading((u) => [...u, file.name]);
      setError(null);
      try {
        const signed = await fetch("/api/research/upload", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ threadId, name: file.name }),
        }).then((r) => r.json());
        if (!signed?.ok) throw new Error(signed?.error ?? "Couldn't prepare the upload.");

        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const { error: upErr } = await supabase.storage
          .from("research")
          .uploadToSignedUrl(signed.data.path, signed.data.token, file);
        if (upErr) throw new Error(upErr.message);

        const reg = await fetch("/api/research/upload", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            threadId, name: file.name, path: signed.data.path,
            mime: file.type || "application/octet-stream", size: file.size,
          }),
        }).then((r) => r.json());
        if (!reg?.ok) throw new Error(reg?.error ?? "Couldn't read that file.");
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }

    if (threadId) await loadThread(threadId);
  }, [id, loadThread]);

  const ask = async () => {
    const q = question.trim();
    if (!q || busy || !id) return;
    setBusy(true); setStreaming(""); setError(null);
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: q, at: new Date().toISOString() }]);
    setQuestion("");

    try {
      const res = await fetch("/api/research/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: id, question: q }),
      });
      if (!res.ok || !res.body) {
        // The route returns JSON on failure and a stream on success, so a
        // failed response has to be read as text before it is trusted.
        const text = await res.text();
        throw new Error(text.slice(0, 200) || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setStreaming(acc);
      }
      setMessages((m) => [...m, { id: `local-a-${Date.now()}`, role: "assistant", content: acc, at: new Date().toISOString() }]);
      setStreaming("");
    } catch (e) {
      setError((e as Error).message);
      setStreaming("");
    } finally {
      setBusy(false);
      void loadThreads();
    }
  };

  const removeFile = async (attachmentId: string) => {
    if (!id) return;
    setThread((t) => (t ? { ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId) } : t));
    await fetch(`/api/research/thread?id=${id}&attachment=${attachmentId}`, { method: "DELETE" }).catch(() => {});
  };

  const removeThread = async (threadId: string) => {
    setThreads((t) => t.filter((x) => x.id !== threadId));
    if (threadId === id) { setId(null); setThread(null); setMessages([]); }
    await fetch(`/api/research/thread?id=${threadId}`, { method: "DELETE" }).catch(() => {});
    void loadThreads();
  };

  return (
    <div
      className={cn("rs-wrap", dragging && "dropping")}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files);
      }}
    >
      {/* ── threads ──────────────────────────────────────────────────── */}
      <aside className="rs-side">
        <button onClick={newThread} className="rs-new"><Plus className="size-3.5" /> New workspace</button>
        <div className="rs-threads">
          {threads.map((t) => (
            <div key={t.id} className={cn("rs-thread", t.id === id && "on")}>
              <button onClick={() => setId(t.id)}>{t.title}</button>
              <button onClick={() => void removeThread(t.id)} className="rs-kill" title="Delete"><Trash2 className="size-3" /></button>
            </div>
          ))}
          {threads.length === 0 && <p className="rs-dim">No workspaces yet.</p>}
        </div>
      </aside>

      {/* ── the conversation ─────────────────────────────────────────── */}
      <main className="rs-main">
        <div className="rs-files">
          <button onClick={() => fileRef.current?.click()} className="rs-attach">
            <Paperclip className="size-3.5" /> Attach
          </button>
          <input
            ref={fileRef} type="file" multiple className="hidden"
            onChange={(e) => { const f = e.target.files; e.target.value = ""; if (f?.length) void upload(f); }}
          />

          {thread?.attachments.map((a) => {
            const Icon = iconFor(a.mime);
            return (
              <span key={a.id} className={cn("rs-file", a.hasText && "read", a.mime.startsWith("image/") && "seen")} title={a.note ?? undefined}>
                {a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.name} className="rs-thumb" />
                ) : (
                  <Icon className="size-3.5 shrink-0" />
                )}
                <span className="rs-filename">{a.name}</span>
                <i>{kb(a.size)}</i>
                <button onClick={() => void removeFile(a.id)} aria-label="Remove"><X className="size-3" /></button>
              </span>
            );
          })}

          {uploading.map((n) => (
            <span key={n} className="rs-file uploading">
              <Loader2 className="size-3.5 animate-spin" /> <span className="rs-filename">{n}</span>
            </span>
          ))}
        </div>

        {/* Files SAGE cannot read say so here rather than producing a vague
            answer that leaves you guessing whether it looked. */}
        {thread?.attachments.some((a) => a.note && !a.hasText && !a.mime.startsWith("image/")) && (
          <div className="rs-notes">
            {thread.attachments.filter((a) => a.note && !a.hasText && !a.mime.startsWith("image/")).map((a) => (
              <p key={a.id}><AlertTriangle className="inline size-3" /> <b>{a.name}</b> — {a.note}</p>
            ))}
          </div>
        )}

        <div className="rs-log">
          {messages.length === 0 && !streaming && (
            <div className="rs-blank">
              <p>Drop a folder of slides, a photo of a whiteboard, a paper, a spreadsheet.</p>
              <p className="rs-dim">
                Then ask across all of it. Files upload straight to storage, so size is not the
                limit it usually is — and I&apos;ll tell you plainly when something is stored but
                not readable.
              </p>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={cn("rs-msg", m.role)}>
              <span className="rs-who">{m.role === "user" ? "YOU" : "SAGE"}</span>
              <div className="rs-body">{m.content}</div>
            </div>
          ))}

          {streaming && (
            <div className="rs-msg assistant">
              <span className="rs-who">SAGE</span>
              <div className="rs-body">{streaming}<span className="rs-caret" /></div>
            </div>
          )}

          {error && <p className="rs-err"><AlertTriangle className="inline size-3.5" /> {error}</p>}
          <div ref={bottomRef} />
        </div>

        <div className="rs-ask">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift-Enter breaks the line — the convention
              // everyone already has in their fingers.
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); }
            }}
            placeholder={thread?.attachments.length ? "Ask across these files…" : "Ask anything, or attach files first…"}
            rows={1}
          />
          <button onClick={() => void ask()} disabled={busy || !question.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
      </main>

      {dragging && <div className="rs-dropzone"><span>Drop to attach</span></div>}
    </div>
  );
}
