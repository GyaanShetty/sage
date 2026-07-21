"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

/**
 * Read-later intake. Reached two ways:
 * - PWA share target: share any link from another app → lands here with ?url=
 * - Manually: paste a URL and hit INGEST.
 * Either way the page feeds /api/ingest, which chunks + embeds it into Knowledge.
 */
function ReadInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const ingest = async (target: string) => {
    const clean = target.trim();
    if (!/^https?:\/\//i.test(clean)) {
      setState("error");
      setMessage("That doesn't look like a link.");
      return;
    }
    setState("working");
    setMessage("Reading, chunking, embedding…");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: clean }),
      });
      const json = await res.json();
      if (json.ok) {
        setState("done");
        setMessage(`Saved to Knowledge — ${json.data?.chunkCount ?? "?"} chunks. It'll show up in flashcards too.`);
      } else {
        setState("error");
        setMessage(json.error ?? "Ingestion failed.");
      }
    } catch {
      setState("error");
      setMessage("Network hiccup — try again.");
    }
  };

  // Shared-in content: the URL usually arrives in ?url, but some apps put it in ?text.
  useEffect(() => {
    const shared = params.get("url") ?? params.get("text")?.match(/https?:\/\/\S+/)?.[0] ?? "";
    if (shared) {
      setUrl(shared);
      ingest(shared);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="section">
      <div className="sectitle"><span className="sn">RL</span><h2>Read Later</h2><span className="line" /><span className="tag">SHARE → SAGE → KNOWLEDGE</span></div>
      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="cell" style={{ maxWidth: 640 }}>
          <div className="bh"><span className="t">Save a link</span><span className="i">URL</span></div>
          <div className="notein">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ingest(url)}
              placeholder="https://…"
              inputMode="url"
            />
            <button onClick={() => ingest(url)} disabled={state === "working"}>
              {state === "working" ? "…" : "INGEST"}
            </button>
          </div>
          {message && (
            <p className="lbl" style={{ marginTop: 10, color: state === "error" ? "#e07070" : state === "done" ? "var(--live)" : undefined }}>
              {message.toUpperCase()}
            </p>
          )}
          {state === "done" && (
            <div className="chips" style={{ marginTop: 12 }}>
              <button className="chip" onClick={() => { setState("idle"); setMessage(""); setUrl(""); }}>SAVE ANOTHER</button>
              <button className="chip" onClick={() => router.push("/knowledge")}>OPEN KNOWLEDGE →</button>
            </div>
          )}
          <p className="lbl" style={{ marginTop: 18, opacity: 0.6 }}>
            TIP: INSTALL SAGE TO YOUR HOME SCREEN, THEN SHARE ANY ARTICLE FROM YOUR BROWSER → SAGE.
          </p>
        </div>
      </div>
    </section>
  );
}

export default function ReadPage() {
  return (
    <Suspense>
      <ReadInner />
    </Suspense>
  );
}
