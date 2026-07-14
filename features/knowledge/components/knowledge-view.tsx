"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Globe, Link2, Loader2, Trash2, Upload, AlertCircle } from "lucide-react";
import { staggerContainer, fadeRise } from "@/lib/motion";
import { GlassPanel } from "@/components/ui/glass-panel";

export interface SourceItem {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  status: string;
  createdAt: string;
  metadata: { chunkCount?: number };
}

export function KnowledgeView({ sources }: { sources: SourceItem[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ingest = async (body: BodyInit, isForm = false) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        ...(isForm ? {} : { headers: { "content-type": "application/json" } }),
        body,
      });
      const json = await res.json();
      if (!json.ok) setError(json.error);
      else setUrl("");
      router.refresh();
    } catch {
      setError("Ingestion failed");
    } finally {
      setBusy(false);
    }
  };

  const addUrl = () => {
    if (!url.trim() || busy) return;
    ingest(JSON.stringify({ url: url.trim() }));
  };

  const addFile = (file: File) => {
    const form = new FormData();
    form.append("file", file);
    ingest(form, true);
  };

  const remove = async (id: string) => {
    await fetch(`/api/source/${id}`, { method: "DELETE" });
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.h1 variants={fadeRise} className="text-2xl font-semibold tracking-tight">
          Knowledge
        </motion.h1>
        <motion.p variants={fadeRise} className="mt-1 text-sm text-muted">
          Feed SAGE articles and PDFs — then just ask about them in chat.
        </motion.p>

        <motion.div variants={fadeRise} className="mt-6 flex gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border-glass bg-glass px-4 transition-colors focus-within:border-border-glass-strong">
            <Link2 className="size-4 shrink-0 text-subtle" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addUrl()}
              placeholder="Paste an article URL…"
              className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
            />
          </div>
          <button
            onClick={addUrl}
            disabled={busy || !url.trim()}
            className="flex h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white shadow-[0_0_16px_var(--accent-glow)] transition-opacity disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
            Ingest
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex h-11 items-center gap-2 rounded-xl border border-border-glass bg-glass px-4 text-sm text-muted transition-colors hover:border-border-glass-strong hover:text-foreground"
          >
            <Upload className="size-4" /> PDF
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            hidden
            onChange={(e) => e.target.files?.[0] && addFile(e.target.files[0])}
          />
        </motion.div>

        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 flex items-center gap-2 text-sm text-red-400"
          >
            <AlertCircle className="size-4" /> {error}
          </motion.p>
        )}

        <div className="mt-8 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {sources.length === 0 && (
              <motion.p variants={fadeRise} className="py-16 text-center text-sm text-subtle">
                Nothing ingested yet.
              </motion.p>
            )}
            {sources.map((source) => (
              <motion.div
                key={source.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                <GlassPanel className="group flex items-center gap-3 p-4">
                  {source.kind === "pdf" ? (
                    <FileText className="size-4 shrink-0 text-muted" />
                  ) : (
                    <Globe className="size-4 shrink-0 text-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{source.title}</p>
                    <p className="text-xs text-subtle">
                      {source.status === "ready"
                        ? `${source.metadata?.chunkCount ?? "?"} chunks`
                        : source.status}
                    </p>
                  </div>
                  {source.status === "processing" && (
                    <Loader2 className="size-4 animate-spin text-accent" />
                  )}
                  <button
                    onClick={() => remove(source.id)}
                    className="rounded-md p-1.5 text-subtle opacity-0 transition-all hover:bg-glass-strong hover:text-red-400 group-hover:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </GlassPanel>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
