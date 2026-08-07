"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic, Square, ImagePlus, Sparkles, Check, X, Loader2, Trash2,
  CheckSquare, ListTodo, Bell, Brain, Wallet, Scale, HelpCircle, FileText,
} from "lucide-react";
import { useVoice } from "@/features/voice/use-voice";
import "./capture.css";

/**
 * Capture — say it once, and it goes where it belongs.
 *
 * The whole point of this page is the gap between "parse" and "file": SAGE
 * proposes, he confirms. Every row is editable in place, because the fix for a
 * misheard amount should not be re-recording the whole thing.
 */

type Kind = "task" | "reminder" | "memory" | "expense" | "decision" | "note" | "question";

interface Item {
  kind: Kind;
  text: string;
  when: string;
  amount: number;
  merchant: string;
  category: string;
  because: string;
}

interface Filed { kind: Kind; text: string; ok: boolean; detail?: string }

const KIND_META: Record<Kind, { label: string; icon: typeof ListTodo; blurb: string }> = {
  task: { label: "Task", icon: ListTodo, blurb: "workspace + TickTick" },
  reminder: { label: "Reminder", icon: Bell, blurb: "pinged at the time" },
  memory: { label: "Memory", icon: Brain, blurb: "remembered for good" },
  expense: { label: "Expense", icon: Wallet, blurb: "your budget" },
  decision: { label: "Decision", icon: Scale, blurb: "scored later" },
  question: { label: "Question", icon: HelpCircle, blurb: "night shift researches it" },
  note: { label: "Note", icon: FileText, blurb: "knowledge" },
};

const KINDS = Object.keys(KIND_META) as Kind[];

/** For the datetime-local input, which wants local wall-clock, not ISO/UTC. */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CaptureView() {
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ name: string; data: string }[]>([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filing, setFiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [filed, setFiled] = useState<Filed[] | null>(null);
  // His real envelopes, so the category box on an expense offers the same list
  // the budget matches on rather than free text that will never join.
  const [categories, setCategories] = useState<string[]>([]);

  const recordingRef = useRef(false);

  useEffect(() => {
    fetch("/api/expenses")
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setCategories(j.data.categories ?? []); })
      .catch(() => undefined);
  }, []);

  const onTranscript = useCallback((chunk: string) => {
    setText((prev) => (prev ? `${prev.trim()} ${chunk}` : chunk));
  }, []);

  const voice = useVoice({ onTranscript });

  // Browser recognition stops after each utterance. A two-minute ramble is
  // many utterances, so restart it until he actually says stop.
  useEffect(() => {
    if (recordingRef.current && !voice.listening) {
      const t = setTimeout(() => { if (recordingRef.current) voice.start(); }, 220);
      return () => clearTimeout(t);
    }
  }, [voice.listening, voice]);

  function startRecording() {
    recordingRef.current = true;
    setRecording(true);
    setError(null);
    voice.start();
  }

  function stopRecording() {
    recordingRef.current = false;
    setRecording(false);
    voice.stop();
  }

  /**
   * Shrink before sending.
   *
   * The old limit was 3MB per image, checked after decoding on the server —
   * which could not work. The request carries base64, a third larger than the
   * bytes, and the platform caps a body at about 4.5MB and rejects it before
   * any handler runs. So one 3MB screenshot was borderline and four were
   * impossible, and the browser reported the rejection as "network dropped" —
   * a network message for a size problem.
   *
   * Downscaling fixes the cause rather than the message. A phone screenshot is
   * three or four megapixels; at 1600px on the long edge it is a few hundred
   * kilobytes and still perfectly legible to a vision model, which is reading
   * text and layout rather than admiring the resolution.
   */
  async function shrink(file: File): Promise<string> {
    const raw = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsDataURL(file);
    });

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = raw;
      });

      const MAX_EDGE = 1600;
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      // Already small enough, and re-encoding would only lose detail.
      if (scale === 1 && raw.length < 700_000) return raw;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return raw;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // JPEG at 0.82: text stays sharp, the file stops being the problem.
      return canvas.toDataURL("image/jpeg", 0.82);
    } catch {
      // Decoding failed (an exotic format, a canvas the browser taints). Send
      // the original and let the size check below have the last word.
      return raw;
    }
  }

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const next: { name: string; data: string }[] = [];

    for (const file of Array.from(files).slice(0, 4)) {
      if (!file.type.startsWith("image/")) continue;
      const data = await shrink(file);
      next.push({ name: file.name, data });
    }

    const combined = [...images, ...next].slice(0, 4);
    // The real constraint is the whole request, not any one picture.
    const total = combined.reduce((n, i) => n + i.data.length, 0);
    if (total > 3_500_000) {
      setError("Those add up to more than one request can carry. Send them a couple at a time.");
      return;
    }
    setImages(combined);
  }

  async function parse() {
    if (recordingRef.current) stopRecording();
    if (!text.trim() && images.length === 0) return;
    setBusy(true);
    setError(null);
    setFiled(null);
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "parse",
          text,
          source: images.length ? "image" : "voice",
          images: images.map((i) => i.data),
        }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error ?? "Couldn't sort that."); return; }
      const got: Item[] = json.data.items ?? [];
      setItems(got);
      setIgnored(json.data.ignored ?? []);
      setPicked(new Set(got.map((_, i) => i)));
    } catch {
      setError("Network dropped on the way there.");
    } finally {
      setBusy(false);
    }
  }

  async function file() {
    if (!items) return;
    const chosen = items.filter((_, i) => picked.has(i));
    if (chosen.length === 0) return;
    setFiling(true);
    setError(null);
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "file", items: chosen }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error ?? "Nothing was written."); return; }
      setFiled(json.data.filed as Filed[]);
      setItems(null);
      setText("");
      setImages([]);
      setIgnored([]);
    } catch {
      setError("Network dropped on the way there.");
    } finally {
      setFiling(false);
    }
  }

  function patch(index: number, change: Partial<Item>) {
    setItems((prev) => prev?.map((it, i) => (i === index ? { ...it, ...change } : it)) ?? prev);
  }

  const chosenCount = picked.size;

  return (
    <div className="cp-wrap">
      <header className="cp-head">
        <h1>Capture</h1>
        <p className="cp-intro">
          Talk at it, or drop a screenshot in. It works out what each piece is and files it where it
          already belongs — nothing is written until you have read the list.
        </p>
      </header>

      {/* ── the input ─────────────────────────────────────────────── */}
      <section className="cp-panel">
        <textarea
          className="cp-text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Buy protein on the way back, remind me to call mum at eight, spent 340 at Blue Tokai, and I keep noticing I focus better before noon…"
        />

        {images.length > 0 && (
          <div className="cp-thumbs">
            {images.map((img, i) => (
              <div key={`${img.name}-${i}`} className="cp-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.data} alt={img.name} />
                <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== i))} aria-label="Remove">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="cp-actions">
          {voice.supported ? (
            recording ? (
              <button type="button" className="cp-btn rec" onClick={stopRecording}>
                <Square size={12} /> Stop
                <i className="cp-pulse" />
              </button>
            ) : (
              <button type="button" className="cp-btn" onClick={startRecording}>
                <Mic size={12} /> Talk
              </button>
            )
          ) : (
            <span className="cp-nomic">No speech recognition in this browser — type it.</span>
          )}

          <label className="cp-btn">
            <ImagePlus size={12} /> Screenshot
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { void addImages(e.target.files); e.target.value = ""; }} />
          </label>

          <button type="button" className="cp-btn go" onClick={() => void parse()} disabled={busy || (!text.trim() && images.length === 0)}>
            {busy ? <Loader2 size={12} className="cp-spin" /> : <Sparkles size={12} />}
            {busy ? "Sorting" : "Sort it out"}
          </button>
        </div>

        {error && <p className="cp-error">{error}</p>}
      </section>

      <datalist id="cp-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>

      {/* ── the review ────────────────────────────────────────────── */}
      {items && (
        <section className="cp-panel">
          <div className="cp-panelhead">
            <h3>Proposed</h3>
            <span className="cp-count">{chosenCount} of {items.length} ticked</span>
          </div>

          {items.length === 0 && <p className="cp-empty">Nothing in there was filable. Say more, or say it plainer.</p>}

          <div className="cp-list">
            {items.map((item, i) => {
              const meta = KIND_META[item.kind] ?? KIND_META.note;
              const Icon = meta.icon;
              const on = picked.has(i);
              return (
                <div key={i} className={`cp-item ${on ? "" : "off"} k-${item.kind}`}>
                  <button
                    type="button"
                    className="cp-tick"
                    aria-label={on ? "Skip this" : "File this"}
                    onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                  >
                    {on ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>

                  <div className="cp-body">
                    <div className="cp-row">
                      <select className="cp-kind" value={item.kind} onChange={(e) => patch(i, { kind: e.target.value as Kind })}>
                        {KINDS.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
                      </select>
                      <Icon size={12} className="cp-kicon" />
                      <span className="cp-dest">{meta.blurb}</span>
                    </div>

                    <textarea className="cp-itemtext" rows={2} value={item.text} onChange={(e) => patch(i, { text: e.target.value })} />

                    {item.kind === "reminder" && (
                      <label className="cp-field">
                        <span>When</span>
                        <input
                          type="datetime-local"
                          value={toLocalInput(item.when)}
                          onChange={(e) => patch(i, { when: e.target.value ? new Date(e.target.value).toISOString() : "" })}
                        />
                      </label>
                    )}

                    {item.kind === "expense" && (
                      <div className="cp-fields">
                        <label className="cp-field">
                          <span>Amount ₹</span>
                          <input type="number" value={item.amount || ""} onChange={(e) => patch(i, { amount: Number(e.target.value) || 0 })} />
                        </label>
                        <label className="cp-field">
                          <span>Where</span>
                          <input value={item.merchant} onChange={(e) => patch(i, { merchant: e.target.value })} />
                        </label>
                        <label className="cp-field">
                          <span>Category</span>
                          <input
                            list="cp-cats"
                            value={item.category}
                            onChange={(e) => patch(i, { category: e.target.value })}
                            placeholder="one of yours"
                          />
                        </label>
                      </div>
                    )}

                    {item.because && <p className="cp-because">{item.because}</p>}
                  </div>

                  <button type="button" className="cp-drop" aria-label="Discard" onClick={() => {
                    setItems((p) => p?.filter((_, j) => j !== i) ?? p);
                    setPicked((p) => new Set([...p].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
                  }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {ignored.length > 0 && (
            <div className="cp-ignored">
              <b>Left out</b>
              {ignored.map((frag, i) => <span key={i}>{frag}</span>)}
            </div>
          )}

          {items.length > 0 && (
            <div className="cp-actions">
              <button type="button" className="cp-btn go" onClick={() => void file()} disabled={filing || chosenCount === 0}>
                {filing ? <Loader2 size={12} className="cp-spin" /> : <Check size={12} />}
                {filing ? "Filing" : `File ${chosenCount}`}
              </button>
              <button type="button" className="cp-btn" onClick={() => { setItems(null); setIgnored([]); }}>
                Discard all
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── what happened ─────────────────────────────────────────── */}
      {filed && (
        <section className="cp-panel">
          <div className="cp-panelhead"><h3>Filed</h3></div>
          <div className="cp-filed">
            {filed.map((f, i) => (
              <div key={i} className={f.ok ? "ok" : "bad"}>
                {f.ok ? <Check size={12} /> : <X size={12} />}
                <b>{KIND_META[f.kind]?.label ?? f.kind}</b>
                <span>{f.text}</span>
                {f.detail && <i>{f.detail}</i>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
