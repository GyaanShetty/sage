"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GeoMap } from "./geo-map";

const pad = (n: number) => String(n).padStart(2, "0");

/* ============ 03 WORLD ============ */
const SHAPES: [number, number][][] = [
  [[-166,68],[-140,70],[-120,72],[-95,74],[-80,72],[-70,62],[-55,52],[-65,45],[-75,40],[-80,32],[-82,26],[-90,22],[-97,20],[-105,22],[-112,28],[-118,34],[-124,42],[-132,52],[-145,60],[-160,62],[-166,68]],
  [[-80,8],[-72,10],[-62,8],[-52,2],[-44,-4],[-38,-10],[-40,-20],[-48,-28],[-56,-36],[-64,-44],[-70,-52],[-72,-46],[-74,-36],[-76,-24],[-80,-12],[-82,-2],[-80,8]],
  [[-16,32],[-6,36],[8,38],[20,33],[32,31],[42,12],[50,10],[46,0],[40,-12],[34,-22],[26,-33],[18,-34],[14,-24],[10,-8],[2,4],[-8,10],[-16,20],[-16,32]],
  [[-10,44],[-8,52],[-2,58],[6,62],[16,66],[28,70],[40,66],[46,58],[38,52],[30,48],[22,44],[12,42],[2,42],[-10,44]],
  [[46,58],[60,68],[80,72],[100,74],[120,72],[140,66],[155,60],[162,52],[150,46],[142,38],[130,32],[122,24],[110,18],[104,10],[98,8],[92,16],[80,10],[76,18],[68,24],[58,28],[50,34],[44,42],[40,50],[46,58]],
  [[114,-22],[122,-14],[132,-12],[142,-14],[150,-24],[152,-32],[146,-38],[136,-36],[126,-32],[116,-30],[114,-22]],
];
const CITIES: [number, number, string][] = [
  [77.6, 13.0, "BLR"], [8.7, 50.1, "FRA"], [-74, 40.7, "NYC"], [103.8, 1.35, "SGP"],
  [139.7, 35.7, "TOK"], [-0.1, 51.5, "LDN"], [151.2, -33.9, "SYD"], [-122.4, 37.8, "SFO"],
];

export function WorldBand({ geo }: { geo?: { lat: number; lon: number } }) {
  const mapRef = useRef<SVGSVGElement>(null);
  const [clocks, setClocks] = useState<Record<string, string>>({});

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const WW = 720, WH = 360;
    const WPT = (lo: number, la: number): [number, number] => [((lo + 180) / 360) * WW, ((90 - la) / 180) * WH];
    let satPhase = 0, raf = 0, last = 0, t0 = performance.now();

    // Live data links between hubs (BLR ↔ world). Packets travel along arcs.
    const HUB = 0; // BLR
    const links = [1, 2, 3, 4, 5, 6, 7].map((to, i) => ({ from: HUB, to, phase: (i / 7) * Math.PI * 2, speed: 0.35 + (i % 3) * 0.15 }));
    const arrivals: { x: number; y: number; t: number }[] = [];

    const draw = (nowMs: number) => {
      const T = (nowMs - t0) / 1000;
      const now = new Date();
      const doy = Math.floor((now.getTime() - new Date(now.getUTCFullYear(), 0, 0).getTime()) / 864e5);
      const decl = ((23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365)) * Math.PI) / 180;
      const subLon = -15 * (now.getUTCHours() + now.getUTCMinutes() / 60 - 12);
      let s = "";
      for (let lon = -180; lon <= 180; lon += 30) {
        const [x] = WPT(lon, 0);
        s += `<line x1="${x}" y1="0" x2="${x}" y2="${WH}" stroke="rgba(244,244,245,.05)"/>`;
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const [, y] = WPT(0, lat);
        s += `<line x1="0" y1="${y}" x2="${WW}" y2="${y}" stroke="rgba(244,244,245,.05)"/>`;
      }
      SHAPES.forEach((sh) => {
        const pts = sh.map(([lo, la]) => WPT(lo, la).map((v) => v.toFixed(1)).join(",")).join(" ");
        s += `<polygon points="${pts}" stroke="rgba(244,244,245,.25)" stroke-width="1" fill="rgba(244,244,245,.04)"/>`;
      });
      const tp: [number, number][] = [];
      for (let lon = -180; lon <= 180; lon += 4) {
        const H = ((lon - subLon) * Math.PI) / 180;
        tp.push(WPT(lon, (Math.atan(-Math.cos(H) / Math.tan(decl || 1e-6)) * 180) / Math.PI));
      }
      const d = "M" + tp.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" L") + ` L${WW},${decl >= 0 ? WH : 0} L0,${decl >= 0 ? WH : 0} Z`;
      s += `<path d="${d}" fill="rgba(0,0,0,.42)" stroke="rgba(244,244,245,.18)" stroke-dasharray="3 3"/>`;
      const [sx, sy] = WPT(subLon, (decl * 180) / Math.PI);
      s += `<circle cx="${sx}" cy="${sy}" r="5" stroke="#f4f4f5" fill="none"/><circle cx="${sx}" cy="${sy}" r="1.5" fill="#f4f4f5"/>`;
      for (let pass = 0; pass < 2; pass++) {
        let pts = "";
        for (let lon = -180; lon <= 180; lon += 4) {
          const lat = 52 * Math.sin((lon * Math.PI) / 180 + satPhase + pass * 2.83);
          const [x, y] = WPT(lon, lat);
          pts += `${x.toFixed(1)},${y.toFixed(1)} `;
        }
        s += `<polyline points="${pts}" stroke="rgba(244,244,245,${pass ? ".14" : ".35"})" fill="none" ${pass ? 'stroke-dasharray="2 4"' : ""}/>`;
      }
      const slon = (((Date.now() / 200) % 720) / 2) - 180, slat = 52 * Math.sin((slon * Math.PI) / 180 + satPhase);
      const [mx2, my2] = WPT(slon, slat);
      s += `<rect x="${mx2 - 3}" y="${my2 - 3}" width="6" height="6" fill="#f4f4f5" transform="rotate(45 ${mx2} ${my2})"/><text x="${mx2 + 8}" y="${my2 - 6}" fill="#9a9a9f" font-size="7" font-family="var(--mono)">SAGE-1</text>`;
      // ── live data links: arcs + travelling packets ──
      links.forEach((lk) => {
        const [ax, ay] = WPT(CITIES[lk.from][0], CITIES[lk.from][1]);
        const [bx, by] = WPT(CITIES[lk.to][0], CITIES[lk.to][1]);
        const mx = (ax + bx) / 2, my = (ay + by) / 2 - Math.hypot(bx - ax, by - ay) * 0.28; // arc apex
        s += `<path d="M${ax.toFixed(1)} ${ay.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}" stroke="rgba(94,207,214,.10)" fill="none"/>`;
        // packet position along the quadratic bezier
        const u = (T * lk.speed + lk.phase / (Math.PI * 2)) % 1;
        const qx = (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * mx + u * u * bx;
        const qy = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * my + u * u * by;
        s += `<circle cx="${qx.toFixed(1)}" cy="${qy.toFixed(1)}" r="1.8" fill="var(--live)"/>`;
        s += `<circle cx="${qx.toFixed(1)}" cy="${qy.toFixed(1)}" r="3.4" fill="none" stroke="rgba(94,207,214,.3)"/>`;
        if (u > 0.985) arrivals.push({ x: bx, y: by, t: nowMs });
      });
      // arrival pulses
      for (let i = arrivals.length - 1; i >= 0; i--) {
        const age = (nowMs - arrivals[i].t) / 900;
        if (age > 1) { arrivals.splice(i, 1); continue; }
        s += `<circle cx="${arrivals[i].x.toFixed(1)}" cy="${arrivals[i].y.toFixed(1)}" r="${(2 + age * 12).toFixed(1)}" stroke="rgba(94,207,214,${(0.5 * (1 - age)).toFixed(2)})" fill="none"/>`;
      }

      CITIES.forEach(([lo, la, l], i) => {
        const [x, y] = WPT(lo, la);
        const hub = i === HUB;
        s += `<circle cx="${x}" cy="${y}" r="${hub ? 3 : 2}" fill="${hub ? "var(--live)" : "#f4f4f5"}"/><text x="${x + 5}" y="${y + 3}" fill="#5c5c62" font-size="7" font-family="var(--mono)">${l}</text>`;
      });
      el.innerHTML = s;
    };

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    draw(performance.now());
    if (!reduced) {
      const loop = (ts: number) => { if (ts - last > 40) { satPhase += 0.0016 * (ts - last); draw(ts); last = ts; } raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const fmt = (tz: string) => {
      const d = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const update = () =>
      setClocks({ BLR: fmt("Asia/Kolkata"), UTC: fmt("UTC"), NYC: fmt("America/New_York"), TOK: fmt("Asia/Tokyo") });
    update();
    const t = setInterval(update, 5000);
    return () => clearInterval(t);
  }, []);

  const LAT = [[0, 142, 215, 38], [142, 0, 88, 168], [215, 88, 0, 232], [38, 168, 232, 0]];
  const NODES = ["BLR", "FRA", "NYC", "SGP"];

  return (
    <section className="section" id="world" style={{ paddingTop: 0 }}>
      <div className="sectitle"><span className="sn">05</span><h2>World</h2><span className="line" /><span className="tag">TERMINATOR · CLOCKS · MESH · GEO</span></div>
      <div className="grid deck3">
        <div className="cell">
          <div className="bh"><span className="t">Global Monitor</span><span className="i">EYE</span><span className="r">DAY/NIGHT LIVE</span></div>
          <svg id="worldmap" ref={mapRef} viewBox="0 0 720 360" preserveAspectRatio="xMidYMid meet" />
        </div>
        <div className="stack">
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
          <div className="cell" style={{ flex: 1 }}>
            <div className="bh"><span className="t" style={{ fontSize: 10 }}>Latency Matrix</span><span className="i">LAT</span><span className="r">MS · SIM</span></div>
            <div className="mx">
              <div className="mxc mxh" />
              {NODES.map((n) => <div className="mxc mxh" key={n}>{n}</div>)}
              {NODES.map((r, i) => (
                <FragmentRow key={r} label={r} row={LAT[i]} />
              ))}
            </div>
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1", display: "grid" }}>
          <GeoMap lat={geo?.lat} lon={geo?.lon} />
        </div>
      </div>
    </section>
  );
}

function FragmentRow({ label, row }: { label: string; row: number[] }) {
  return (
    <>
      <div className="mxc mxh">{label}</div>
      {row.map((v, j) => {
        if (v === 0) return <div className="mxc mxv" key={j}><span>—</span></div>;
        const op = Math.max(0, 1 - v / 260);
        return (
          <div className={`mxc mxv${op > 0.55 ? " dark" : ""}`} key={j}>
            <div className="fill" style={{ opacity: op }} />
            <span>{v}</span>
          </div>
        );
      })}
    </>
  );
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
    const sleep = num(health.sleepHours ?? health.sleep);
    const kcal = num(health.activeKcal ?? health.calories);
    const hr = num(health.restingHr ?? health.hr);
    if (!Number.isNaN(steps)) vitals.push({ k: "STEPS", v: Math.round(steps).toLocaleString("en-IN") });
    if (!Number.isNaN(sleep)) vitals.push({ k: "SLEEP HRS", v: sleep.toFixed(1) });
    if (!Number.isNaN(kcal)) vitals.push({ k: "ACTIVE KCAL", v: String(Math.round(kcal)) });
    if (!Number.isNaN(hr)) vitals.push({ k: "RESTING HR", v: String(Math.round(hr)) });
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
        <div className="cell">
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
        </div>
        <div className="cell jrn">
          <div className="bh"><span className="t">Journal</span><span className="i">JRN</span><span className="r">{entries.length} TODAY</span></div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="End-of-day reflection…" />
          <button className="jbtn" onClick={log}>LOG ENTRY</button>
          <div style={{ marginTop: 12 }}>
            {entries.map((e, i) => (
              <div className="jent" key={i}><div className="jx">{e}</div></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
