"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GeoMap } from "./geo-map";
import { AtlasMap } from "@/features/atlas/atlas-map";
import { ExpandableCell } from "./expandable-cell";

const pad = (n: number) => String(n).padStart(2, "0");

/* ============ 05 WORLD — atlas + sky panel ============ */
interface SkyData {
  iss: { lat: number; lon: number; alt: number; vel: number } | null;
  planes: { lat: number; lon: number }[];
  sun: { sunrise: string; sunset: string } | null;
  moon: { phase: number; illum: number; name: string };
}

export function WorldBand({ geo }: { geo?: { lat: number; lon: number } }) {
  const [clocks, setClocks] = useState<Record<string, string>>({});
  const [sky, setSky] = useState<SkyData | null>(null);

  // Pull live sky data (ISS + sun/moon) for the SKY panel.
  useEffect(() => {
    const load = () => {
      const q = geo ? `?lat=${geo.lat}&lon=${geo.lon}` : "";
      fetch(`/api/sky${q}`).then((r) => r.json()).then((j) => setSky(j.data)).catch(() => {});
    };
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [geo]);

  useEffect(() => {
    const fmt = (tz: string) => {
      const d = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const update = () => setClocks({ BLR: fmt("Asia/Kolkata"), UTC: fmt("UTC"), NYC: fmt("America/New_York"), TOK: fmt("Asia/Tokyo") });
    update();
    const t = setInterval(update, 5000);
    return () => clearInterval(t);
  }, []);

  const istTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="section" id="world" style={{ paddingTop: 0 }}>
      <div className="sectitle"><span className="sn">05</span><h2>World</h2><span className="line" /><span className="tag">ATLAS · FLIGHTS · SATS · RAIN · TRADE · CONFLICT</span></div>
      {/* Google-Earth-style intelligence atlas with toggleable live layers */}
      <div style={{ marginBottom: 1 }}>
        <AtlasMap lat={geo?.lat ?? 20} lon={geo?.lon ?? 40} />
      </div>
      <div className="grid deck3">
        <div className="cell">
          <div className="bh"><span className="t" style={{ fontSize: 10 }}>World Clocks</span><span className="i">TZ</span></div>
          <div className="clocks">
            {(["BLR", "UTC", "NYC", "TOK"] as const).map((k) => (
              <div className="ck2" key={k}>
                <div className="cv num">{clocks[k] ?? "--:--"}</div>
                <div className="ckk">{k === "BLR" ? "Bengaluru" : k === "NYC" ? "New York" : k === "TOK" ? "Tokyo" : "UTC"}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="cell">
          <div className="bh"><span className="t" style={{ fontSize: 10 }}>Sky</span><span className="i">SKY</span><span className="r">LIVE</span></div>
          <div className="skygrid">
            <div className="skyrow"><span className="skk">MOON</span><span className="skv">{moonGlyph(sky?.moon.phase ?? 0)} {sky?.moon.name ?? "—"}{sky ? ` · ${Math.round(sky.moon.illum * 100)}%` : ""}</span></div>
            <div className="skyrow"><span className="skk">SUNRISE</span><span className="skv">{sky?.sun ? `${istTime(sky.sun.sunrise)} IST` : "—"}</span></div>
            <div className="skyrow"><span className="skk">SUNSET</span><span className="skv">{sky?.sun ? `${istTime(sky.sun.sunset)} IST` : "—"}</span></div>
            <div className="skyrow"><span className="skk">ISS ALT</span><span className="skv">{sky?.iss ? `${Math.round(sky.iss.alt)} km · ${Math.round(sky.iss.vel).toLocaleString()} km/h` : "—"}</span></div>
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1", display: "grid" }}>
          <GeoMap lat={geo?.lat} lon={geo?.lon} />
        </div>
      </div>
    </section>
  );
}

function moonGlyph(phase: number): string {
  const g = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
  return g[Math.round(phase * 8) % 8];
}

/* ============ 04 CONSOLE ============ */
export function ConsoleBand({ stats }: { stats: { open: number; notes: number; memories: number } }) {
  const outRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ text: string; cls?: string }[]>([
    { text: "SAGE terminal — type help" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>([]);
  const histIdx = useRef(-1);

  const COMMANDS = ["help", "status", "ask ", "note ", "task ", "clear"];
  const suggestion = input && !input.includes(" ")
    ? COMMANDS.find((c) => c.trimEnd().startsWith(input) && c.trimEnd() !== input)?.trimEnd()
    : undefined;

  useEffect(() => {
    outRef.current?.scrollTo(0, outRef.current.scrollHeight);
  }, [lines]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const v = input;
      if (v.trim()) { history.current.unshift(v); histIdx.current = -1; }
      exec(v);
      setInput("");
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (suggestion) setInput(suggestion + " ");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (histIdx.current < history.current.length - 1) { histIdx.current++; setInput(history.current[histIdx.current]); }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx.current > 0) { histIdx.current--; setInput(history.current[histIdx.current]); }
      else { histIdx.current = -1; setInput(""); }
    }
  };

  const print = useCallback((text: string, cls?: string) => setLines((l) => [...l.slice(-60), { text, cls }]), []);

  const exec = async (raw: string) => {
    const v = raw.trim();
    if (!v || busy) return;
    print("sage › " + v, "cmd");
    const [cmd, ...rest] = v.split(" ");
    const arg = rest.join(" ");
    setBusy(true);
    try {
      if (cmd === "help") {
        print("commands: help · status · ask <q> · note <text> · task <title> · done · clear");
      } else if (cmd === "status") {
        print(`nominal · ${stats.open} directives open · ${stats.notes} notes · ${stats.memories} memories`);
      } else if (cmd === "clear") {
        setLines([]);
      } else if (cmd === "note" && arg) {
        await fetch("/api/note", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: arg }) });
        print("note captured");
      } else if (cmd === "task" && arg) {
        await fetch("/api/task", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: arg }) });
        print("directive deployed: " + arg);
      } else if (cmd === "ask" && arg) {
        print("…thinking");
        const res = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: arg }) });
        const json = await res.json();
        print(json?.data?.text ?? "no response");
      } else {
        // any unknown input goes to the brain
        print("…thinking");
        const res = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: v }) });
        const json = await res.json();
        print(json?.data?.text ?? "no response");
      }
    } catch {
      print("link error", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section" id="console" style={{ paddingTop: 0 }}>
      <div className="sectitle"><span className="sn">06</span><h2>Console</h2><span className="line" /><span className="tag">TERMINAL · REAL COMMANDS</span></div>
      <div className="grid deck6">
        <div className="cell">
          <div className="bh"><span className="t">Terminal</span><span className="i">TTY</span><span className="r">sage@command</span></div>
          <div className="term">
            <div className="tout" ref={outRef}>
              {lines.map((l, i) => <div className={`tl${l.cls ? " " + l.cls : ""}`} key={i}>{l.text}</div>)}
            </div>
            <div className="tin">
              <span className="tp" style={{ color: busy ? "var(--live)" : undefined }}>sage ›</span>
              <div style={{ position: "relative", flex: 1 }}>
                {suggestion && (
                  <span style={{ position: "absolute", inset: 0, pointerEvents: "none", color: "var(--faint)", fontFamily: "var(--mono)", fontSize: 11, lineHeight: "1.4" }}>
                    {input}<span style={{ opacity: 0.7 }}>{suggestion.slice(input.length)}</span>
                    <span style={{ color: "var(--subtle)" }}> ⇥</span>
                  </span>
                )}
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ position: "relative", width: "100%", background: "none", border: "none", outline: "none", color: "var(--foreground)", fontFamily: "var(--mono)", fontSize: 11 }}
                />
              </div>
              <span className="term-cursor" />
            </div>
          </div>
        </div>
        <div className="cell">
          <div className="bh"><span className="t" style={{ fontSize: 10 }}>Command Reference</span><span className="i">REF</span></div>
          {[
            ["ask <q>", "route a question to the agent (tools + memory)"],
            ["note <text>", "capture a note to the workspace"],
            ["task <title>", "deploy a new directive"],
            ["status", "system counts"],
            ["anything else", "goes straight to the brain"],
          ].map(([c, d]) => (
            <div className="note" key={c}>
              <span className="nb" />
              <div style={{ flex: 1 }}>
                <div className="ntx" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{c}</div>
                <div className="nt2">{d.toUpperCase()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============ 05 REVIEW ============ */
export function ReviewBand({ activity, journal, health }: { activity: number[]; journal: string[]; health?: Record<string, unknown> | null }) {
  const vitals: { k: string; v: string }[] = [];
  if (health) {
    const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" ? parseFloat(x) : NaN);
    const steps = num(health.steps);
    const sleepMin = num(health.sleepMinutes);
    const sleep = !Number.isNaN(sleepMin) ? sleepMin / 60 : num(health.sleepHours ?? health.sleep);
    const kcal = num(health.activeKcal ?? health.calories);
    const hr = num(health.restingHr ?? health.hr);
    // 0 means "no data recorded", not a real reading — hide those tiles.
    if (steps > 0) vitals.push({ k: "STEPS", v: Math.round(steps).toLocaleString("en-IN") });
    if (sleep > 0) vitals.push({ k: "SLEEP HRS", v: sleep.toFixed(1) });
    if (kcal > 0) vitals.push({ k: "ACTIVE KCAL", v: String(Math.round(kcal)) });
    if (hr > 0) vitals.push({ k: "RESTING HR", v: String(Math.round(hr)) });
  }
  return <ReviewBandInner activity={activity} journal={journal} vitals={vitals} />;
}

function ReviewBandInner({ activity, journal, vitals }: { activity: number[]; journal: string[]; vitals: { k: string; v: string }[] }) {
  const [entries, setEntries] = useState(journal);
  const [text, setText] = useState("");
  const days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const max = Math.max(4, ...activity);
  const W = 460, H = 190;
  const bw = W / 7;

  const log = async () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    setEntries((e) => [v, ...e]);
    await fetch("/api/journal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: v }),
    });
  };

  return (
    <section className="section" id="review" style={{ paddingTop: 0 }}>
      <div className="sectitle"><span className="sn">07</span><h2>Review</h2><span className="line" /><span className="tag">ACTIVITY · VITALS · JOURNAL</span></div>
      {vitals.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${vitals.length}, 1fr)`, marginBottom: 1 }}>
          {vitals.map((v) => (
            <div className="cell ct" key={v.k}>
              <div className="cv num">{v.v}</div>
              <div className="ck">{v.k}</div>
            </div>
          ))}
        </div>
      )}
      <div className="grid deck7">
        <ExpandableCell title="System Activity" tag="EVENTS / DAY">
          <div className="bh"><span className="t">System Activity</span><span className="i">WKL</span><span className="r">EVENTS / DAY · REAL</span></div>
          <svg id="weekchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {Array.from({ length: 5 }).map((_, i) => {
              const y = H - 18 - (i / 4) * (H - 34);
              return <line key={i} x1="0" y1={y} x2={W} y2={y} stroke="rgba(244,244,245,.05)" />;
            })}
            {activity.map((v, i) => {
              const bh = (v / max) * (H - 34);
              return (
                <g key={i}>
                  <rect x={i * bw + 10} y={H - 18 - bh} width={bw - 20} height={Math.max(bh, 1)} fill={i === (new Date().getDay() + 6) % 7 ? "#f4f4f5" : "#5c5c62"} />
                  <text x={i * bw + bw / 2} y={H - 4} fill="#5c5c62" fontSize="7.5" fontFamily="var(--mono)" textAnchor="middle">{days[i]}</text>
                  <text x={i * bw + bw / 2} y={H - 24 - bh} fill="#9a9a9f" fontSize="8" fontFamily="var(--mono)" textAnchor="middle">{v || ""}</text>
                </g>
              );
            })}
          </svg>
        </ExpandableCell>
        <ExpandableCell title="Journal" tag="REFLECT" className="jrn">
          <div className="bh"><span className="t">Journal</span><span className="i">JRN</span><span className="r">{entries.length} TODAY</span></div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="End-of-day reflection…" />
          <button className="jbtn" onClick={log}>LOG ENTRY</button>
          <div style={{ marginTop: 12 }}>
            {entries.map((e, i) => (
              <div className="jent" key={i}><div className="jx">{e}</div></div>
            ))}
          </div>
        </ExpandableCell>
      </div>
    </section>
  );
}
