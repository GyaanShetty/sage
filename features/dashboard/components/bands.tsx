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

interface Plane { lat: number; lon: number; callsign: string; origin: string; alt: number; vel: number; heading: number }
interface SkyData {
  iss: { lat: number; lon: number; alt: number; vel: number } | null;
  planes: Plane[];
  sun: { sunrise: string; sunset: string } | null;
  moon: { phase: number; illum: number; name: string };
}
interface Marker { x: number; y: number; label: string }

export function WorldBand({ geo }: { geo?: { lat: number; lon: number } }) {
  const mapRef = useRef<SVGSVGElement>(null);
  const [clocks, setClocks] = useState<Record<string, string>>({});
  const [sky, setSky] = useState<SkyData | null>(null);
  const skyRef = useRef<SkyData | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Pull live sky data (ISS + planes + sun/moon) and refresh.
  useEffect(() => {
    const load = () => {
      const q = geo ? `?lat=${geo.lat}&lon=${geo.lon}` : "";
      fetch(`/api/sky${q}`)
        .then((r) => r.json())
        .then((j) => { skyRef.current = j.data; setSky(j.data); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [geo]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const WW = 720, WH = 360;
    const WPT = (lo: number, la: number): [number, number] => [((lo + 180) / 360) * WW, ((90 - la) / 180) * WH];
    let raf = 0, last = 0;

    const draw = () => {
      const now = new Date();
      const doy = Math.floor((now.getTime() - new Date(now.getUTCFullYear(), 0, 0).getTime()) / 864e5);
      const decl = ((23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365)) * Math.PI) / 180;
      const subLon = -15 * (now.getUTCHours() + now.getUTCMinutes() / 60 - 12);
      const markers: Marker[] = [];
      let s = "";
      for (let lon = -180; lon <= 180; lon += 30) { const [x] = WPT(lon, 0); s += `<line x1="${x}" y1="0" x2="${x}" y2="${WH}" stroke="rgba(244,244,245,.05)"/>`; }
      for (let lat = -60; lat <= 60; lat += 30) { const [, y] = WPT(0, lat); s += `<line x1="0" y1="${y}" x2="${WW}" y2="${y}" stroke="rgba(244,244,245,.05)"/>`; }
      SHAPES.forEach((sh) => {
        const pts = sh.map(([lo, la]) => WPT(lo, la).map((v) => v.toFixed(1)).join(",")).join(" ");
        s += `<polygon points="${pts}" stroke="rgba(244,244,245,.25)" stroke-width="1" fill="rgba(244,244,245,.04)"/>`;
      });
      // real day/night terminator
      const tp: [number, number][] = [];
      for (let lon = -180; lon <= 180; lon += 4) {
        const H = ((lon - subLon) * Math.PI) / 180;
        tp.push(WPT(lon, (Math.atan(-Math.cos(H) / Math.tan(decl || 1e-6)) * 180) / Math.PI));
      }
      const d = "M" + tp.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" L") + ` L${WW},${decl >= 0 ? WH : 0} L0,${decl >= 0 ? WH : 0} Z`;
      s += `<path d="${d}" fill="rgba(0,0,0,.42)" stroke="rgba(244,244,245,.18)" stroke-dasharray="3 3"/>`;
      const [sx, sy] = WPT(subLon, (decl * 180) / Math.PI);
      s += `<circle cx="${sx}" cy="${sy}" r="6" stroke="#f4f4f5" fill="none"/><circle cx="${sx}" cy="${sy}" r="2" fill="#f4f4f5"/>`;
      for (let r = 8; r < 16; r += 3) s += `<circle cx="${sx}" cy="${sy}" r="${r}" stroke="rgba(244,244,245,.12)" fill="none"/>`;
      markers.push({ x: sx, y: sy, label: "☉ SUBSOLAR — sun directly overhead here" });

      const data = skyRef.current;
      // real aircraft
      for (const p of data?.planes ?? []) {
        const [x, y] = WPT(p.lon, p.lat);
        const a = ((p.heading - 90) * Math.PI) / 180;
        const tipx = x + 4 * Math.cos(a), tipy = y + 4 * Math.sin(a);
        const l1x = x + 3 * Math.cos(a + 2.5), l1y = y + 3 * Math.sin(a + 2.5);
        const l2x = x + 3 * Math.cos(a - 2.5), l2y = y + 3 * Math.sin(a - 2.5);
        s += `<polygon points="${tipx.toFixed(1)},${tipy.toFixed(1)} ${l1x.toFixed(1)},${l1y.toFixed(1)} ${l2x.toFixed(1)},${l2y.toFixed(1)}" fill="rgba(244,244,245,.7)"/>`;
        markers.push({ x, y, label: `✈ ${p.callsign} · ${p.origin} · ${Math.round(p.alt).toLocaleString()}m · ${Math.round(p.vel * 3.6)}km/h` });
      }
      // ISS: ground track + marker
      if (data?.iss) {
        let track = "";
        for (let lon = -180; lon <= 180; lon += 4) {
          const lat = 51.6 * Math.sin(((lon - data.iss.lon) * Math.PI) / 180);
          const [x, y] = WPT(lon, lat + (data.iss.lat - 51.6 * Math.sin(0)));
          track += `${x.toFixed(1)},${y.toFixed(1)} `;
        }
        s += `<polyline points="${track}" stroke="rgba(94,207,214,.35)" fill="none" stroke-dasharray="2 4"/>`;
        const [ix, iy] = WPT(data.iss.lon, data.iss.lat);
        s += `<circle cx="${ix}" cy="${iy}" r="10" fill="none" stroke="rgba(94,207,214,.35)"/>`;
        s += `<rect x="${ix - 3.5}" y="${iy - 3.5}" width="7" height="7" fill="var(--live)" transform="rotate(45 ${ix} ${iy})"/>`;
        s += `<text x="${ix + 10}" y="${iy - 6}" fill="var(--live)" font-size="7.5" font-family="var(--mono)">ISS</text>`;
        markers.push({ x: ix, y: iy, label: `🛰 ISS · ${Math.round(data.iss.alt)}km alt · ${Math.round(data.iss.vel).toLocaleString()}km/h` });
      }
      CITIES.forEach(([lo, la, l], i) => {
        const [x, y] = WPT(lo, la);
        const hub = i === 0;
        s += `<circle cx="${x}" cy="${y}" r="${hub ? 3 : 2}" fill="${hub ? "var(--live)" : "#5c5c62"}"/><text x="${x + 5}" y="${y + 3}" fill="#5c5c62" font-size="7" font-family="var(--mono)">${l}</text>`;
      });
      el.innerHTML = s;
      markersRef.current = markers;
    };

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    draw();
    if (!reduced) {
      const loop = (ts: number) => { if (ts - last > 1000) { draw(); last = ts; } raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(raf);
  }, [sky]);

  // Hover-identify: hit-test markers in viewBox space.
  const onMapMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = mapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * 720;
    const vy = ((e.clientY - rect.top) / rect.height) * 360;
    let best: Marker | null = null, bestD = 12;
    for (const m of markersRef.current) {
      const dd = Math.hypot(m.x - vx, m.y - vy);
      if (dd < bestD) { bestD = dd; best = m; }
    }
    setTip(best ? { x: e.clientX - rect.left, y: e.clientY - rect.top, text: best.label } : null);
  };

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
      <div className="sectitle"><span className="sn">05</span><h2>World</h2><span className="line" /><span className="tag">TERMINATOR · AIRCRAFT · ISS · SKY</span></div>
      <div className="grid deck3">
        <div className="cell" style={{ position: "relative" }}>
          <div className="bh"><span className="t">Global Monitor</span><span className="i">EYE</span><span className="r">{sky ? `${sky.planes.length} AIRCRAFT · LIVE` : "LINKING…"}</span></div>
          <svg id="worldmap" ref={mapRef} viewBox="0 0 720 360" preserveAspectRatio="xMidYMid meet" onPointerMove={onMapMove} onPointerLeave={() => setTip(null)} style={{ cursor: "crosshair" }} />
          {tip && <div className="map-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
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
            <div className="bh"><span className="t" style={{ fontSize: 10 }}>Sky</span><span className="i">SKY</span><span className="r">LIVE</span></div>
            <div className="skygrid">
              <div className="skyrow"><span className="skk">MOON</span><span className="skv">{moonGlyph(sky?.moon.phase ?? 0)} {sky?.moon.name ?? "—"}{sky ? ` · ${Math.round(sky.moon.illum * 100)}%` : ""}</span></div>
              <div className="skyrow"><span className="skk">SUNRISE</span><span className="skv">{sky?.sun ? `${istTime(sky.sun.sunrise)} IST` : "—"}</span></div>
              <div className="skyrow"><span className="skk">SUNSET</span><span className="skv">{sky?.sun ? `${istTime(sky.sun.sunset)} IST` : "—"}</span></div>
              <div className="skyrow"><span className="skk">ISS ALT</span><span className="skv">{sky?.iss ? `${Math.round(sky.iss.alt)} km · ${Math.round(sky.iss.vel).toLocaleString()} km/h` : "—"}</span></div>
              <div className="skyrow"><span className="skk">AIRCRAFT</span><span className="skv">{sky ? `${sky.planes.length} tracked nearby` : "—"}</span></div>
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
