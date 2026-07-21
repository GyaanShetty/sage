"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "../command.css";
import { tzHour, fmt } from "@/lib/config";

/* ─── data contracts (all real, server-fetched) ─── */
export interface TaskRow { id: string; title: string; status: string; dueAt: string | null }
export interface EventRow { summary: string; start: string; allDay?: boolean }
export interface NoteRow { id: string; title: string; createdAt: string }
export interface LogRow { type: string; createdAt: string }
export interface Stats { memories: number; sources: number; runs: number; notes: number }
export interface WeatherRow { temp: number; high: number; low: number; label: string; wind: number; place: string }

const pad = (n: number) => String(n).padStart(2, "0");

const LOG_LABEL: Record<string, string> = {
  "memory.extracted": "memory committed",
  "brief.generated": "brief compiled",
  "reminder.fired": "reminder fired",
  "automation.completed": "automation complete",
};

/* ─── Gita rotator (design element from the prototype) ─── */
const GITA = [
  { dev: "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥", tr: "karmaṇy-evādhikāras te mā phaleṣu kadācana", en: "Your right is to the work alone, never to its fruits. Let not the fruits be your motive, nor attachment to inaction.", src: "2.47" },
  { dev: "योगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय ।\nसिद्ध्यसिद्ध्योः समो भूत्वा समत्वं योग उच्यते ॥", tr: "yoga-sthaḥ kuru karmāṇi saṅgaṁ tyaktvā dhanañjaya", en: "Established in yoga, perform action, abandoning attachment — balanced in success and failure. That equanimity is called yoga.", src: "2.48" },
  { dev: "उद्धरेदात्मनात्मानं नात्मानमवसादयेत् ।\nआत्मैव ह्यात्मनो बन्धुरात्मैव रिपुरात्मनः ॥", tr: "uddhared ātmanātmānaṁ nātmānam avasādayet", en: "Lift yourself by your own self; do not let the self sink. The self alone is your friend, and the self alone your enemy.", src: "6.5" },
  { dev: "तस्मादसक्तः सततं कार्यं कर्म समाचर ।\nअसक्तो ह्याचरन्कर्म परमाप्नोति पूरुषः ॥", tr: "tasmād asaktaḥ satataṁ kāryaṁ karma samācara", en: "Therefore, without attachment, always do the work that must be done — for acting without attachment one attains the highest.", src: "3.19" },
];

/* ─── hero dial + globe (ported) ─── */
function Dial() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cx = 200, cy = 200;
    let out = "";
    for (let d = 0; d < 360; d += 2) {
      const lg = d % 30 === 0, r1 = 190, r2 = lg ? 176 : 184, a = (d * Math.PI) / 180;
      out += `<line x1="${cx + r1 * Math.cos(a)}" y1="${cy + r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cy + r2 * Math.sin(a)}" stroke="${lg ? "#9a9a9f" : "#2c2c30"}" stroke-width="1"/>`;
    }
    [0, 90, 180, 270].forEach((d) => {
      const a = (d * Math.PI) / 180;
      out += `<text x="${cx + 166 * Math.cos(a)}" y="${cy + 166 * Math.sin(a) + 3}" fill="#5c5c62" font-family="var(--mono)" font-size="8" text-anchor="middle">${String(d).padStart(3, "0")}</text>`;
    });
    el.innerHTML = `<circle cx="${cx}" cy="${cy}" r="192" stroke="rgba(244,244,245,.13)" stroke-width="1" fill="none"/><circle cx="${cx}" cy="${cy}" r="150" stroke="rgba(244,244,245,.06)" stroke-width="1" fill="none"/>${out}<g class="rot-med" stroke="#5c5c62" stroke-width="1" fill="none"><circle cx="${cx}" cy="${cy}" r="150" stroke-dasharray="2 6"/><path d="M${cx} ${cy - 150} l-5 -9 h10 z" fill="#f4f4f5" stroke="none"/></g>`;
  }, []);
  return <svg id="dial" ref={ref} viewBox="0 0 400 400" fill="none" />;
}

function Globe({ nodeCount = 8 }: { nodeCount?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cx = 150, cy = 150, Rg = 112;
    let ph = 0, raf = 0, last = 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Orbiting memory nodes: each on a tilted plane at its own radius/speed/phase.
    const N = Math.max(5, Math.min(14, nodeCount));
    const nodes = Array.from({ length: N }, (_, i) => ({
      r: Rg * (1.06 + (i % 3) * 0.12),
      tilt: (-0.5 + (i / N)) * 1.1,       // orbital plane tilt
      speed: 0.006 + (i % 4) * 0.0025,
      phase: (i / N) * Math.PI * 2,
      syncAt: 0,
    }));

    const project = (n: (typeof nodes)[number], t: number) => {
      const a = n.phase + t * n.speed * 60;
      const x = Math.cos(a) * n.r;
      const yFlat = Math.sin(a) * n.r;
      const y = yFlat * Math.cos(n.tilt);
      const z = yFlat * Math.sin(n.tilt);       // +z = front
      return { x: cx + x, y: cy + y, front: z >= 0, depth: (z + n.r) / (2 * n.r) };
    };

    const frame = (t: number) => {
      const breath = reduced ? 1 : 1 + Math.sin(t * 0.0014) * 0.02;
      const R = Rg * breath;
      let s = "";
      // ambient core glow
      s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#gcore)"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="${R}" stroke="rgba(244,244,245,.26)" stroke-width="1" fill="none"/>`;
      for (const lat of [-60, -30, 0, 30, 60]) {
        const f = (lat * Math.PI) / 180, rx = R * Math.cos(f), ry = rx * 0.3, y = cy - R * Math.sin(f) * 0.62;
        s += `<ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${ry}" stroke="${lat === 0 ? "rgba(244,244,245,.32)" : "rgba(244,244,245,.12)"}" stroke-width="1" fill="none"/>`;
      }
      for (let i = 0; i < 8; i++) {
        const w = Math.cos(ph + (i * Math.PI) / 8), rx = Math.abs(w) * R, op = (0.08 + 0.20 * Math.abs(w)).toFixed(3);
        s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx.toFixed(1)}" ry="${R}" stroke="rgba(244,244,245,${op})" stroke-width="1" fill="none"/>`;
      }

      // constellation links between nearby front-facing nodes
      const pts = nodes.map((n) => project(n, t));
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          if (!pts[i].front || !pts[j].front) continue;
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.hypot(dx, dy);
          if (d < 74) s += `<line x1="${pts[i].x.toFixed(1)}" y1="${pts[i].y.toFixed(1)}" x2="${pts[j].x.toFixed(1)}" y2="${pts[j].y.toFixed(1)}" stroke="rgba(94,207,214,${(0.16 * (1 - d / 74)).toFixed(3)})"/>`;
        }
      }
      // orbiting memory nodes (occasional cyan sync pulse)
      nodes.forEach((n, i) => {
        const p = pts[i];
        if (Math.random() < 0.004) n.syncAt = t;
        const syncing = t - n.syncAt < 700;
        const size = (p.front ? 2.6 : 1.4) * (0.6 + p.depth * 0.6);
        const fill = syncing ? "var(--live)" : "#f4f4f5";
        const op = p.front ? 1 : 0.3;
        if (syncing) {
          const age = (t - n.syncAt) / 700;
          s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(3 + age * 9).toFixed(1)}" stroke="rgba(94,207,214,${(0.5 * (1 - age)).toFixed(2)})" fill="none"/>`;
        }
        s += `<rect x="${(p.x - size).toFixed(1)}" y="${(p.y - size).toFixed(1)}" width="${(size * 2).toFixed(1)}" height="${(size * 2).toFixed(1)}" transform="rotate(45 ${p.x.toFixed(1)} ${p.y.toFixed(1)})" fill="${fill}" opacity="${op}"/>`;
      });

      el.innerHTML =
        `<defs><radialGradient id="gcore" cx="50%" cy="50%" r="50%">` +
        `<stop offset="0%" stop-color="rgba(94,207,214,0.06)"/><stop offset="70%" stop-color="rgba(94,207,214,0.015)"/><stop offset="100%" stop-color="transparent"/>` +
        `</radialGradient></defs>` + s;
    };

    frame(0);
    if (!reduced) {
      const loop = (t: number) => { if (t - last > 33) { ph += 0.012; frame(t); last = t; } raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(raf);
  }, [nodeCount]);
  return <svg id="globe" ref={ref} viewBox="0 0 300 300" fill="none" />;
}

/* ─── main view ─── */
export function CommandView({
  tasks: initialTasks,
  events,
  notes: initialNotes,
  log,
  stats,
  weather,
  steps,
  userName,
}: {
  tasks: TaskRow[];
  events: EventRow[] | null;
  notes: NoteRow[];
  log: LogRow[];
  stats: Stats;
  weather: WeatherRow | null;
  steps?: number | null;
  userName: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [notes, setNotes] = useState(initialNotes);
  const [gi, setGi] = useState(0);
  const [ask, setAsk] = useState("");
  const [askOut, setAskOut] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [focusSec, setFocusSec] = useState(25 * 60);
  const [focusRun, setFocusRun] = useState(false);

  const now = new Date();
  const hour = tzHour(now);
  const greet = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const open = tasks.filter((t) => t.status !== "done").length;
  const todays = (events ?? []).filter((e) => new Date(e.start).toDateString() === now.toDateString());

  /* gita rotation */
  useEffect(() => {
    const t = setInterval(() => setGi((g) => (g + 1) % GITA.length), 45000);
    return () => clearInterval(t);
  }, []);

  /* focus timer */
  useEffect(() => {
    if (!focusRun) return;
    const t = setInterval(() => setFocusSec((s) => (s > 0 ? s - 1 : 25 * 60)), 1000);
    return () => clearInterval(t);
  }, [focusRun]);

  /* real AI ask (voice brain, text-in text-out) */
  const doAsk = useCallback(async (q: string) => {
    if (!q.trim() || asking) return;
    setAsking(true);
    setAskOut("…");
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: q }),
      });
      const json = await res.json();
      setAskOut(json?.data?.text ?? "No response.");
    } catch {
      setAskOut("Link error — try again.");
    } finally {
      setAsking(false);
    }
  }, [asking]);

  const toggleTask = async (task: TaskRow) => {
    const status = task.status === "done" ? "todo" : "done";
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
    await fetch(`/api/task/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  const addNote = async () => {
    const text = noteText.trim();
    if (!text) return;
    setNoteText("");
    const res = await fetch("/api/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: text }),
    });
    const { data } = await res.json();
    setNotes((prev) => [{ id: data.id, title: text, createdAt: new Date().toISOString() }, ...prev].slice(0, 6));
    router.refresh();
  };

  const delNote = async (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/note/${id}`, { method: "DELETE" });
  };

  /* focus ring geometry */
  const fr = 40, fc = 2 * Math.PI * fr;
  const fpct = 1 - focusSec / (25 * 60);
  const gita = GITA[gi];

  /* calendar grid */
  const Y = now.getFullYear(), M = now.getMonth();
  const first = new Date(Y, M, 1), dim = new Date(Y, M + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7, prevDim = new Date(Y, M, 0).getDate();
  const evDays = new Set((events ?? []).map((e) => { const d = new Date(e.start); return d.getMonth() === M ? d.getDate() : -1; }));

  return (
    <div>
      {/* ================= 01 HOME ================= */}
      <section className="section" id="home">
        <div className="sectitle"><span className="sn">01</span><h2>Home</h2><span className="line" /><span className="tag">ASSISTANT · NOTES · GITA · AGENDA</span></div>
        <div className="grid deck1">
          {/* left */}
          <div className="stack">
            <div className="cell">
              <div className="bh"><span className="t">Intelligence</span><span className="i">MEM</span><span className="r">LIVE</span></div>
              <div className="counters" style={{ margin: 0 }}>
                <div className="ct"><div className="cv num">{stats.memories}</div><div className="ck">Memories</div></div>
                <div className="ct"><div className="cv num">{stats.sources}</div><div className="ck">Sources</div></div>
                <div className="ct"><div className="cv num">{stats.runs}</div><div className="ck">Agent runs</div></div>
                <div className="ct"><div className="cv num">{stats.notes}</div><div className="ck">Notes</div></div>
              </div>
            </div>
            <div className="cell" style={{ flex: 1 }}>
              <div className="bh"><span className="t">Notes</span><span className="i">NTS</span><span className="r">{pad(notes.length)}</span></div>
              <div className="notein">
                <input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} placeholder="capture a thought…" />
                <button onClick={addNote}>ADD</button>
              </div>
              {notes.map((n) => (
                <div className="note" key={n.id}>
                  <span className="nb" />
                  <div style={{ flex: 1 }}>
                    <div className="ntx">{n.title}</div>
                    <div className="nt2">{fmt(n.createdAt, { hour: "2-digit", minute: "2-digit", hour12: false })}</div>
                  </div>
                  <button className="del" onClick={() => delNote(n.id)}>×</button>
                </div>
              ))}
            </div>
          </div>

          {/* center */}
          <div className="stack">
            <div className="cell hero">
              <Dial />
              <Globe nodeCount={Math.round(stats.memories / 2) + 5} />
              <div className="greeting">
                <div className="g1">Sage · Online</div>
                <div className="g2">{greet}, {userName}</div>
                <div className="g3">
                  {weather ? `${weather.place} ${weather.temp}° · ${weather.label} · ` : ""}
                  {todays.length} events today · {open} open
                </div>
              </div>
              <div className="vitrow">
                {weather && (
                  <>
                    <div className="vv num">{weather.temp}°</div>
                    <div className="vk">{weather.place} · {weather.high}°/{weather.low}°</div>
                    <div className="dv" />
                  </>
                )}
                <div className="vv num">{open}</div><div className="vk">Open</div>
                <div className="dv" />
                <div className="vv num">{todays.length}</div><div className="vk">Events</div>
                {typeof steps === "number" && steps > 0 && (
                  <>
                    <div className="dv" />
                    <div className="vv num">{Math.round(steps).toLocaleString("en-IN")}</div>
                    <div className="vk">Steps</div>
                  </>
                )}
              </div>
            </div>
            <div className="cell ask">
              <div className="askbox">
                <span className="sig" />
                <input
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { doAsk(ask); setAsk(""); } }}
                  placeholder="Ask Sage anything…"
                />
                <span className="kb">↵</span>
              </div>
              <div className="chips">
                {["What's my plan today?", "Summarize my unread email", "What do you know about me?", "Any tasks due soon?"].map((q) => (
                  <button key={q} className="chip" onClick={() => doAsk(q)}>{q}</button>
                ))}
              </div>
              <div className="sageout">{asking ? "…" : askOut && <><b>Sage:</b> {askOut}</>}</div>
            </div>
          </div>

          {/* right */}
          <div className="stack right">
            <div className="cell gita">
              <div className="bh"><span className="t">Gita</span><span className="i">श्लोक</span></div>
              <button className="nxt" onClick={() => setGi((g) => (g + 1) % GITA.length)}>NEXT →</button>
              <div className="dev">{gita.dev}</div>
              <div className="tr">{gita.tr}</div>
              <div className="en">{gita.en}</div>
              <div className="src"><span>अध्याय {gita.src}</span><i /><span>BHAGAVAD GITA</span></div>
            </div>
            <div className="cell">
              <div className="bh"><span className="t">{now.toLocaleString("en", { month: "long" }).toUpperCase()} {Y}</span><span className="i">CAL</span></div>
              <div className="cal">
                {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((d) => <div className="dh" key={d}>{d}</div>)}
                {Array.from({ length: lead }).map((_, i) => <div className="d out" key={`p${i}`}>{prevDim - lead + 1 + i}</div>)}
                {Array.from({ length: dim }).map((_, i) => (
                  <div className={`d${i + 1 === now.getDate() ? " today" : ""}`} key={i}>
                    {pad(i + 1)}
                    {evDays.has(i + 1) && <span className="ev" />}
                  </div>
                ))}
              </div>
            </div>
            <div className="cell" style={{ flex: 1 }}>
              <div className="bh"><span className="t">Agenda</span><span className="i">AGD</span><span className="r">{events ? "LIVE" : "OFFLINE"}</span></div>
              {(events ?? []).slice(0, 4).map((e, i) => {
                const d = new Date(e.start);
                const isNext = i === 0;
                return (
                  <div className={`ag${isNext ? " now" : ""}`} key={i}>
                    <span className="tm">
                      {fmt(d, { weekday: "short" }).toUpperCase()}{" "}
                      {e.allDay ? "ALL DAY" : fmt(d, { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </span>
                    <span className="mk2"><i /></span>
                    <div><div className="en2">{e.summary}</div><div className="el2">{isNext ? "NEXT" : "SCHEDULED"}</div></div>
                  </div>
                );
              })}
              {events !== null && events.length === 0 && <p className="lbl">NO UPCOMING EVENTS</p>}
              {events === null && <p className="lbl">CONNECT GOOGLE IN SETTINGS</p>}
            </div>
          </div>
        </div>
      </section>

      {/* ================= 02 EXECUTE ================= */}
      <section className="section" id="exec" style={{ paddingTop: 0 }}>
        <div className="sectitle"><span className="sn">02</span><h2>Execute</h2><span className="line" /><span className="tag">DIRECTIVES · FOCUS · ACTIVITY</span></div>
        <div className="grid deck2a">
          <div className="cell">
            <div className="bh"><span className="t">Directives</span><span className="i">TSK</span><span className="r">{tasks.filter((t) => t.status === "done").length}/{tasks.length}</span></div>
            {tasks.map((t, i) => (
              <div className={`task${t.status === "done" ? " done" : ""}`} key={t.id} onClick={() => toggleTask(t)}>
                <span className="box" /><span className="tx">{t.title}</span><span className="rank">{pad(i + 1)}</span>
              </div>
            ))}
            {tasks.length === 0 && <p className="lbl">NO OPEN DIRECTIVES</p>}
          </div>
          <div className="cell">
            <div className="bh">
              <span className="t">Focus Cycle</span><span className="i">FCS</span>
              <span className="r" style={{ display: "flex", gap: 10 }}>
                <button className="lbl" style={{ cursor: "pointer" }} onClick={() => setFocusRun((r) => !r)}>{focusRun ? "PAUSE" : "START"}</button>
                <button className="lbl" style={{ cursor: "pointer" }} onClick={() => { setFocusRun(false); setFocusSec(25 * 60); }}>RESET</button>
              </span>
            </div>
            <div className="fring">
              <svg viewBox="0 0 92 92">
                <circle cx="46" cy="46" r={fr} fill="none" stroke="#2c2c30" strokeWidth="2.5" />
                <circle cx="46" cy="46" r={fr} fill="none" stroke="#f4f4f5" strokeWidth="2.5" strokeDasharray={fc} strokeDashoffset={fc * (1 - fpct)} transform="rotate(-90 46 46)" strokeLinecap="round" />
                <circle cx="46" cy="46" r="31" fill="none" stroke="#1c1c1f" strokeWidth="1" strokeDasharray="2 4" />
              </svg>
              <div>
                <div className="ft2 num">{pad(Math.floor(focusSec / 60))}:{pad(focusSec % 60)}</div>
                <div className="fk">DEEP WORK · POMODORO</div>
              </div>
            </div>
            <div className="counters">
              <div className="ct"><div className="cv num">{open}</div><div className="ck">Open</div></div>
              <div className="ct"><div className="cv num">{tasks.filter((t) => t.status === "done").length}</div><div className="ck">Done</div></div>
              <div className="ct"><div className="cv num">{todays.length}</div><div className="ck">Events</div></div>
              <div className="ct"><div className="cv num">{stats.runs}</div><div className="ck">Runs</div></div>
            </div>
          </div>
          <div className="cell" style={{ display: "flex", flexDirection: "column" }}>
            <div className="bh"><span className="t">Activity</span><span className="i">LOG</span><span className="r">SYSTEM</span></div>
            <div className="feed">
              {log.map((row, i) => (
                <div className="fr" key={i}>
                  <span className="ft">{fmt(row.createdAt, { hour: "2-digit", minute: "2-digit", hour12: false })}</span>{" "}
                  <span className={i === 0 ? "fh" : ""}>{LOG_LABEL[row.type] ?? row.type}</span>
                </div>
              ))}
              {log.length === 0 && <div className="fr"><span className="ft">—</span> no activity yet</div>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
