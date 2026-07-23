"use client";

import { useState } from "react";
import "@/features/dashboard/command.css";

interface Part { name: string; role: string; importance: number; connectsTo: string[] }
interface Blueprint { title: string; overview: string; parts: Part[]; howItWorks: string; modelQuery: string }
interface Model { uid: string; name: string; author: string; thumb: string | null }

const SUGGESTIONS = ["A V8 engine", "The human heart", "A jet turbine", "The human brain", "A rocket engine", "A skeleton"];

export function HoloLab() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [bp, setBp] = useState<Blueprint | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [live, setLive] = useState(false); // model iframe engaged
  const [selected, setSelected] = useState<Part | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async (t: string) => {
    const q = t.trim();
    if (!q || loading) return;
    setLoading(true); setError(null); setSelected(null); setBp(null); setModel(null); setLive(false);
    try {
      const res = await fetch("/api/lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: q }) });
      const j = await res.json();
      if (!j.ok) { setError(j.error ?? "Could not build the blueprint."); setLoading(false); return; }
      setBp(j.data);
      // fetch a real 3D model in parallel
      fetch(`/api/lab/model?q=${encodeURIComponent(j.data.modelQuery || q)}`)
        .then((r) => r.json()).then((m) => setModel(m.data)).catch(() => {});
    } catch {
      setError("Link error — try again.");
    }
    setLoading(false);
  };

  const explain = async (p: Part) => {
    try {
      const res = await fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `${p.name}. ${p.role}` }) });
      if (res.ok) { const a = new Audio(URL.createObjectURL(await res.blob())); a.play().catch(() => {}); }
    } catch {}
  };

  const embed = model ? `https://sketchfab.com/models/${model.uid}/embed?autospin=0.4&autostart=1&preload=1&ui_theme=dark&dnt=1&ui_infos=0&ui_controls=1&ui_stop=0` : null;

  return (
    <div className="holo">
      <div className="holo-hud">
        <div className="sectitle" style={{ marginBottom: 12 }}><span className="sn">LAB</span><h2>Holo-Lab</h2><span className="line" /><span className="tag">LEARN ANYTHING IN 3D</span></div>
        <div className="holo-input">
          <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate(topic)} placeholder="What do you want to understand?  e.g. a jet engine" />
          <button onClick={() => generate(topic)} disabled={loading}>{loading ? "BUILDING…" : "MATERIALISE"}</button>
        </div>
        {!bp && !loading && (
          <div className="chips" style={{ marginTop: 12 }}>
            {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => { setTopic(s); generate(s); }}>{s}</button>)}
          </div>
        )}
        {error && <p className="lbl" style={{ color: "#e07070", marginTop: 10 }}>{error.toUpperCase()}</p>}
      </div>

      {/* real 3D model stage */}
      <div className="holo-stage">
        {embed && live ? (
          <iframe className="holo-frame" src={embed} title={model?.name ?? "model"} allow="autoplay; fullscreen; xr-spatial-tracking" allowFullScreen />
        ) : embed ? (
          <button className="holo-poster" style={model?.thumb ? { backgroundImage: `url(${model.thumb})` } : undefined} onClick={() => setLive(true)}>
            <span className="holo-play">▶ ENGAGE 3D MODEL</span>
          </button>
        ) : bp && !loading ? (
          <div className="holo-nomodel">NO 3D MODEL FOUND FOR THIS — STUDY THE BREAKDOWN →</div>
        ) : null}
      </div>

      {loading && <div className="holo-loading"><div className="holo-spinner" />COMPILING BLUEPRINT…</div>}

      {bp && (
        <>
          <div className="holo-overview">
            <div className="ho-title">{bp.title}</div>
            <p className="ho-text">{bp.overview}</p>
            {model && <p className="lbl" style={{ marginTop: 8, opacity: 0.6 }}>MODEL: {model.name} · © {model.author} (Sketchfab)</p>}
          </div>

          <div className="holo-parts">
            <div className="hp-head">COMPONENTS · TAP TO STUDY</div>
            <div className="hp-scroll">
              {bp.parts.map((p) => (
                <button key={p.name} className={`hp-item${selected?.name === p.name ? " on" : ""}`} onClick={() => setSelected(selected?.name === p.name ? null : p)}>
                  <span className="hp-dot" style={{ opacity: 0.3 + p.importance * 0.23 }} />
                  <span className="hp-nm">{p.name}</span>
                </button>
              ))}
            </div>
            {selected ? (
              <div className="hp-detail">
                <div className="hp-dname">{selected.name}</div>
                <p className="hp-drole">{selected.role}</p>
                {selected.connectsTo.length > 0 && <p className="hp-dconn">CONNECTS: {selected.connectsTo.join(" · ")}</p>}
                <button className="chip fc-got" style={{ marginTop: 10 }} onClick={() => explain(selected)}>▶ EXPLAIN ALOUD</button>
              </div>
            ) : (
              <div className="hp-detail"><div className="hp-dname" style={{ fontSize: 10, letterSpacing: 2, color: "var(--subtle)" }}>HOW IT WORKS</div><p className="hp-drole">{bp.howItWorks}</p></div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
