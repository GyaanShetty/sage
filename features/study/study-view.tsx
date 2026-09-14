"use client";

/**
 * The study wall.
 *
 * One tab per subject, plus an overview that compares them. Each subject gets
 * the same set of instruments in the same places, because the point of a wall
 * is that you learn where to look once: completion on the left, time in the
 * middle, the syllabus and the timetable on the right.
 *
 * Two numbers are kept visibly apart everywhere on this page — how much of the
 * syllabus is finished, and how many hours have gone in. They are not the same
 * measurement and a page that blends them teaches you to sit with a book open
 * and call it progress.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pane, Row, Stat, Empty } from "@/components/pane";
import { TileGuard } from "@/components/tile-guard";
import { Acquiring } from "@/components/ui/acquiring";
import { Area, BarRows, Diverging, Donut, Gauge, Heat, Histogram, Radial, Stack } from "@/components/instruments";
import { asArray } from "@/lib/as-array";
import { lastDays } from "@/lib/config";
import {
  burnUp, completion, minutesByDay, minutesByUnit, minutesByWeekday, nextSlot, pace,
  scheduledMinutes, weeklyActual, clockOf, WEEKDAYS,
  type Session, type Subject, type Unit,
} from "@/core/study/model";
import "@/features/dashboard/wall.css";
import "@/features/dashboard/command.css";
import "./study.css";

interface Exam { id: string; subject: string; at: string; doneAt?: string | null }

const TONE_VAR: Record<string, string> = {
  signal: "var(--signal)", amber: "#ff9f0a", cyan: "#35c7ff", green: "#2fd07a", plain: "var(--muted)",
};

const hours = (min: number) => (min >= 60 ? `${(min / 60).toFixed(1)}H` : `${Math.round(min)}M`);
const pct = (f: number) => `${Math.round(f * 100)}%`;

export function StudyView() {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [tab, setTab] = useState<string>("all");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch("/api/study?days=120").then((r) => r.json()).catch(() => null);
    setSubjects(asArray<Subject>(j?.data?.subjects));
    setSessions(asArray<Session>(j?.data?.sessions));
    setExams(asArray<Exam>(j?.data?.exams));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    await fetch("/api/study", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => {});
    setBusy(false);
    void load();
  }, [load]);

  const days30 = useMemo(() => lastDays(30), []);
  const days84 = useMemo(() => lastDays(84), []);

  if (subjects === null) return <div className="wall"><Acquiring label="SUBJECTS" /></div>;

  const current = subjects.find((s) => s.id === tab);

  return (
    <div className="wall-shell study">
      <div className="wall-tabs">
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
          <em>0</em> ALL SUBJECTS
        </button>
        {subjects.map((s, i) => (
          <button key={s.id} className={tab === s.id ? "on" : ""} onClick={() => setTab(s.id)}
            style={{ ["--c" as string]: TONE_VAR[s.tone] ?? "var(--signal)" }}>
            <em>{i + 1}</em> {s.name.toUpperCase()}
          </button>
        ))}
        <button className="wall-tab-add" onClick={() => void addSubject(post)}>+ SUBJECT</button>
      </div>

      {tab === "all"
        ? <Overview subjects={subjects} sessions={sessions} exams={exams} days30={days30} days84={days84} />
        : current
          ? <SubjectWall
              subject={current}
              sessions={sessions.filter((x) => x.subjectId === current.id)}
              exam={exams.find((e) => e.id === current.examId) ?? null}
              days30={days30} days84={days84} post={post} busy={busy}
            />
          : null}
    </div>
  );
}

async function addSubject(post: (b: Record<string, unknown>) => Promise<void>) {
  const name = window.prompt("Subject name (e.g. Operating Systems)")?.trim();
  if (!name) return;
  await post({ name });
}

/* ── every subject at once ───────────────────────────────────────────────── */

function Overview({
  subjects, sessions, exams, days30, days84,
}: { subjects: Subject[]; sessions: Session[]; exams: Exam[]; days30: string[]; days84: string[] }) {
  if (!subjects.length) {
    return (
      <div className="wall">
        <Empty reason="No subjects yet — add one to start tracking units, time and schedule" action="Add a subject" />
      </div>
    );
  }

  const per = subjects.map((s) => {
    const mine = sessions.filter((x) => x.subjectId === s.id);
    const exam = exams.find((e) => e.id === s.examId) ?? null;
    return {
      subject: s,
      minutes: mine.reduce((n, x) => n + x.minutes, 0),
      done: completion(s),
      drift: pace(s, exam?.at ?? null),
      weekly: weeklyActual(mine),
      sessions: mine,
    };
  });

  const totalMin = per.reduce((n, p) => n + p.minutes, 0);
  const allMinutes = minutesByDay(sessions, days30);
  const heat = minutesByDay(sessions, days84);

  return (
    <div className="wall">
      <div className="wall-pack">
        <div className="t-3x2"><TileGuard name="TOTAL"><Pane n={1} title="The term so far" status={`${subjects.length} SUBJECTS`} live>
          <div className="km">
            <Stat v={hours(totalMin)} k="LOGGED" />
            <Stat v={pct(per.reduce((n, p) => n + p.done, 0) / per.length)} k="SYLLABUS" />
            <Stat v={hours(per.reduce((n, p) => n + p.weekly, 0))} k="PER WEEK" />
          </div>
        </Pane></TileGuard></div>

        <div className="t-3x2"><TileGuard name="SHARE"><Pane n={2} title="Where the time goes" status="BY SUBJECT">
          <Donut slices={per.map((p) => ({ label: p.subject.name, value: p.minutes }))} />
        </Pane></TileGuard></div>

        <div className="t-3x2"><TileGuard name="COMPLETION"><Pane n={3} title="Syllabus done" status="WEIGHTED">
          <Radial data={per.map((p) => p.done)} labels={per.map((p) => p.subject.name.slice(0, 6).toUpperCase())} />
        </Pane></TileGuard></div>

        <div className="t-3x2"><TileGuard name="PACE"><Pane n={4} title="Ahead or behind" status="VS THE CLOCK"
          alert={per.some((p) => (p.drift ?? 0) < -0.2) ? "signal" : undefined}>
          {per.some((p) => p.drift !== null)
            ? <Diverging rows={per.filter((p) => p.drift !== null)
                .map((p) => ({ label: p.subject.name.slice(0, 10), value: Math.round((p.drift ?? 0) * 100) }))} />
            : <Empty reason="Pace needs an exam date and a syllabus" />}
        </Pane></TileGuard></div>

        <div className="t-6x2"><TileGuard name="DAILY"><Pane n={5} title="Minutes a day" status="30 DAYS" live>
          <Area data={allMinutes} height={70} />
        </Pane></TileGuard></div>

        <div className="t-6x2"><TileGuard name="HEAT"><Pane n={6} title="Study heat" status="12 WEEKS">
          <Heat days={heat} weeks={12} />
        </Pane></TileGuard></div>

        <div className="t-4x2"><TileGuard name="BALANCE"><Pane n={7} title="Balance" status="MINUTES">
          <Stack parts={per.map((p) => ({ label: p.subject.name, value: p.minutes, tone: TONE_VAR[p.subject.tone] }))} height={14} />
          <div className="st-legend">
            {per.map((p) => (
              <span key={p.subject.id}><i style={{ background: TONE_VAR[p.subject.tone] }} />{p.subject.name} · {hours(p.minutes)}</span>
            ))}
          </div>
        </Pane></TileGuard></div>

        <div className="t-4x2"><TileGuard name="TARGET"><Pane n={8} title="Planned against actual" status="HOURS / WEEK">
          <BarRows rows={per.map((p) => ({
            label: p.subject.name.slice(0, 14),
            value: Math.round(p.weekly / 60),
            max: Math.max(1, p.subject.targetHoursPerWeek),
            tone: p.weekly / 60 >= p.subject.targetHoursPerWeek ? "ok" : "warm",
          }))} />
        </Pane></TileGuard></div>

        <div className="t-4x2"><TileGuard name="WEEKDAY"><Pane n={9} title="Which days" status="ALL SUBJECTS">
          <Radial data={minutesByWeekday(sessions)} labels={[...WEEKDAYS]} />
        </Pane></TileGuard></div>

        <div className="t-6x2"><TileGuard name="LENGTHS"><Pane n={10} title="Session lengths" status={`${sessions.length} SESSIONS`}>
          {sessions.length
            ? <Histogram values={sessions.map((s) => s.minutes)} height={70} />
            : <Empty reason="No sessions logged yet" />}
        </Pane></TileGuard></div>

        <div className="t-6x2"><TileGuard name="CUMULATIVE"><Pane n={11} title="Hours, cumulative" status="30 DAYS">
          {/* The shape of a term: flat stretches are the weeks that got away. */}
          <Area data={allMinutes.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], [])}
            height={70} baseline={false} />
        </Pane></TileGuard></div>

        <div className="t-12x2"><TileGuard name="TABLE"><Pane n={12} title="Every subject" status={`${subjects.length} TRACKED`}>
          <div className="sv-table">
            <div className="sv-th"><span>SUBJECT</span><span>UNITS</span><span>DONE</span><span>LOGGED</span><span>PER WK</span><span>TARGET</span><span>PACE</span><span>EXAM</span></div>
            {per.map((p) => {
              const exam = exams.find((e) => e.id === p.subject.examId);
              const d = exam ? Math.ceil((new Date(exam.at).getTime() - Date.now()) / 86_400_000) : null;
              return (
                <div className="sv-tr" key={p.subject.id}>
                  <span style={{ color: TONE_VAR[p.subject.tone] }}>{p.subject.name}</span>
                  <span>{p.subject.units.length}</span>
                  <span>{pct(p.done)}</span>
                  <span>{hours(p.minutes)}</span>
                  <span>{hours(p.weekly)}</span>
                  <span>{p.subject.targetHoursPerWeek}H</span>
                  <span className={p.drift === null ? "" : p.drift >= 0 ? "up" : "down"}>
                    {p.drift === null ? "—" : `${p.drift >= 0 ? "+" : ""}${Math.round(p.drift * 100)}%`}
                  </span>
                  <span>{d === null ? "—" : `${d}D`}</span>
                </div>
              );
            })}
          </div>
        </Pane></TileGuard></div>
      </div>
    </div>
  );
}

/* ── one subject, in depth ───────────────────────────────────────────────── */

function SubjectWall({
  subject, sessions, exam, days30, days84, post, busy,
}: {
  subject: Subject; sessions: Session[]; exam: Exam | null;
  days30: string[]; days84: string[];
  post: (b: Record<string, unknown>) => Promise<void>; busy: boolean;
}) {
  const tone = TONE_VAR[subject.tone] ?? "var(--signal)";
  const done = completion(subject);
  const drift = pace(subject, exam?.at ?? null);
  const totalMin = sessions.reduce((n, s) => n + s.minutes, 0);
  const weekly = weeklyActual(sessions);
  const targetMin = subject.targetHoursPerWeek * 60;
  const byUnit = minutesByUnit(sessions, subject.units);
  const daily = minutesByDay(sessions, days30);
  const next = nextSlot(subject.slots);
  const examDays = exam ? Math.ceil((new Date(exam.at).getTime() - Date.now()) / 86_400_000) : null;

  // Cumulative hours, so the shape of a term is visible rather than inferred.
  const cumulative = daily.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], []);

  return (
    <div className="wall">
      <div className="wall-pack">
        <div className="t-3x3"><TileGuard name="PROGRESS"><Pane n={1} title={subject.name} status={subject.code ?? "SYLLABUS"} live>
          <div className="sv-hero">
            <Gauge value={Math.round(done * 100)} max={100} label="DONE" unit="%" tone={tone} size={104} />
            <div className="sv-hero-side">
              <Stat v={`${subject.units.filter((u) => u.doneAt).length}/${subject.units.length}`} k="UNITS" />
              <Stat v={hours(totalMin)} k="LOGGED" />
              {examDays !== null && <Stat v={`${Math.max(0, examDays)}D`} k="TO EXAM" tone={examDays <= 7 ? "down" : undefined} />}
            </div>
          </div>
        </Pane></TileGuard></div>

        <div className="t-3x3"><TileGuard name="UNITS"><Pane
          n={2} title="Units" status={`${subject.units.length} TOTAL`}
          edit={<UnitAdd subjectId={subject.id} post={post} busy={busy} />}
        >
          {subject.units.length === 0
            ? <Empty reason="No units yet — add the chapters and this page can measure them" />
            : (
              <div className="sv-units">
                {subject.units.map((u) => (
                  <button
                    key={u.id}
                    className={`sv-unit${u.doneAt ? " done" : ""}`}
                    disabled={busy}
                    onClick={() => void post({
                      action: "unit", subjectId: subject.id,
                      unit: { id: u.id, doneAt: u.doneAt ? null : new Date().toISOString() },
                    })}
                    title={u.doneAt ? "Mark as not done" : "Mark as done"}
                  >
                    <i style={{ borderColor: tone, background: u.doneAt ? tone : "transparent" }} />
                    <span className="sv-unit-n">{u.name}</span>
                    {u.weight > 1 && <em>×{u.weight}</em>}
                  </button>
                ))}
              </div>
            )}
        </Pane></TileGuard></div>

        <div className="t-3x3"><TileGuard name="WHERE"><Pane n={3} title="Time per unit" status="MINUTES">
          {byUnit.some((r) => r.minutes > 0)
            ? <BarRows rows={byUnit.map((r) => ({ label: r.unit.name.slice(0, 14), value: r.minutes, tone: r.unit.doneAt ? "ok" : "warm" }))} />
            : <Empty reason="No sessions logged against a unit yet" />}
        </Pane></TileGuard></div>

        <div className="t-3x3"><TileGuard name="SCHEDULE"><Pane
          n={4} title="Timetable" status={`${(scheduledMinutes(subject) / 60).toFixed(1)}H/WK`}
          edit={<SlotAdd subjectId={subject.id} post={post} busy={busy} />}
        >
          {subject.slots.length === 0
            ? <Empty reason="No slots — a subject with no time set aside usually gets none" />
            : (
              <>
                {subject.slots
                  .slice()
                  .sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin)
                  .map((s) => (
                    <Row key={s.id}
                      k={`${WEEKDAYS[s.weekday]} ${clockOf(s.startMin)}`}
                      v={<>
                        {s.minutes}M
                        <button className="sv-x" disabled={busy}
                          onClick={() => void post({ action: "slot.remove", subjectId: subject.id, slotId: s.id })}>×</button>
                      </>}
                    />
                  ))}
                {next && (
                  <div className="sv-next">
                    NEXT · {WEEKDAYS[next.slot.weekday]} {clockOf(next.slot.startMin)} —{" "}
                    {next.inMinutes < 60 ? `in ${next.inMinutes}m` : `in ${Math.round(next.inMinutes / 60)}h`}
                  </div>
                )}
              </>
            )}
        </Pane></TileGuard></div>

        <div className="t-6x2"><TileGuard name="DAILY"><Pane n={5} title="Minutes a day" status="30 DAYS" live>
          <Area data={daily} height={72} tone={tone} />
        </Pane></TileGuard></div>

        <div className="t-6x2"><TileGuard name="CUMULATIVE"><Pane n={6} title="Hours, cumulative" status="30 DAYS">
          <Area data={cumulative} height={72} tone={tone} baseline={false} />
        </Pane></TileGuard></div>

        <div className="t-4x2"><TileGuard name="PACE"><Pane n={7} title="Against the clock" status={exam ? "VS EXAM" : "NO EXAM SET"}
          alert={drift !== null && drift < -0.2 ? "signal" : undefined}>
          {drift === null
            ? <Empty reason="Pace needs both an exam date and units to measure" />
            : (
              <>
                <Stat v={`${drift >= 0 ? "+" : ""}${Math.round(drift * 100)}%`} k={drift >= 0 ? "AHEAD" : "BEHIND"} tone={drift >= 0 ? "up" : "down"} />
                <Diverging rows={[{ label: "SYLLABUS", value: Math.round(drift * 100) }]} />
              </>
            )}
        </Pane></TileGuard></div>

        <div className="t-4x2"><TileGuard name="TARGET"><Pane n={8} title="This week" status={`TARGET ${subject.targetHoursPerWeek}H`}>
          <Gauge value={Math.round(weekly / 60)} max={Math.max(1, subject.targetHoursPerWeek)} label="PER WEEK" unit="H" tone={tone} />
        </Pane></TileGuard></div>

        <div className="t-4x2"><TileGuard name="WEEKDAY"><Pane n={9} title="Which days" status="ALL TIME">
          <Radial data={minutesByWeekday(sessions)} labels={[...WEEKDAYS]} tone={tone} />
        </Pane></TileGuard></div>

        <div className="t-6x2"><TileGuard name="HEAT"><Pane n={10} title="Study heat" status="12 WEEKS">
          <Heat days={minutesByDay(sessions, days84)} weeks={12} tone={tone} />
        </Pane></TileGuard></div>

        <div className="t-6x2"><TileGuard name="LENGTHS"><Pane n={11} title="Session lengths" status={`${sessions.length} SESSIONS`}>
          {sessions.length
            ? <Histogram values={sessions.map((s) => s.minutes)} height={72} />
            : <Empty reason="No sessions logged yet" />}
        </Pane></TileGuard></div>

        <div className="t-6x3"><TileGuard name="LOG"><Pane
          n={12} title="Sessions" status={hours(totalMin)}
          edit={<SessionAdd subject={subject} post={post} busy={busy} />}
        >
          {sessions.length === 0
            ? <Empty reason="Nothing logged yet — SAGE can log these by voice too" />
            : sessions.slice(0, 14).map((s) => (
                <Row key={s.id}
                  k={<>{new Date(s.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    {s.unitId && <em className="sv-unit-tag">{subject.units.find((u) => u.id === s.unitId)?.name ?? ""}</em>}</>}
                  v={`${s.minutes}M`}
                />
              ))}
        </Pane></TileGuard></div>

        <div className="t-3x3"><TileGuard name="BURNUP"><Pane n={13} title="Syllabus burn-up" status="UNITS DONE">
          {/*
            Units ticked over time, from each unit's own doneAt. A step up per
            unit, weighted the same way the percentage is — so this chart and
            the gauge in pane 01 cannot disagree, because they are the same
            arithmetic over the same field.
          */}
          {subject.units.some((u) => u.doneAt)
            ? <Area data={burnUp(subject.units, days30)} height={110} tone={tone} baseline={false} />
            : <Empty reason="Tick a unit and this fills in" />}
        </Pane></TileGuard></div>

        <div className="t-3x3"><TileGuard name="SETTINGS"><Pane n={14} title="Subject" status="SETTINGS">
          <Row k="Weekly target" v={
            <input className="sv-num" type="number" min={0} max={60} defaultValue={subject.targetHoursPerWeek}
              onBlur={(e) => void post({ id: subject.id, targetHoursPerWeek: Number(e.target.value) })} />
          } />
          <Row k="Code" v={
            <input className="sv-txt" defaultValue={subject.code ?? ""} placeholder="CS3501"
              onBlur={(e) => void post({ id: subject.id, code: e.target.value })} />
          } />
          <Row k="Scheduled" v={`${(scheduledMinutes(subject) / 60).toFixed(1)}H / WEEK`} />
          <Row k="Actual" v={`${(weekly / 60).toFixed(1)}H / WEEK`} tone={weekly >= targetMin ? "up" : "down"} />
          <Row k="Units done" v={`${subject.units.filter((u) => u.doneAt).length} of ${subject.units.length}`} />
          {exam && <Row k="Exam" v={new Date(exam.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} />}
        </Pane></TileGuard></div>
      </div>
    </div>
  );
}

/* ── the three little editors ────────────────────────────────────────────── */

function UnitAdd({ subjectId, post, busy }: { subjectId: string; post: (b: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState("");
  const [weight, setWeight] = useState(1);
  const add = () => {
    if (!name.trim()) return;
    void post({ action: "unit", subjectId, unit: { name, weight } });
    setName("");
    setWeight(1);
  };
  return (
    <div className="sv-add">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="UNIT NAME"
        onKeyDown={(e) => e.key === "Enter" && add()} />
      <input type="number" min={1} max={9} value={weight} onChange={(e) => setWeight(Number(e.target.value))} title="Weight" />
      <button onClick={add} disabled={busy}>ADD UNIT</button>
    </div>
  );
}

function SlotAdd({ subjectId, post, busy }: { subjectId: string; post: (b: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("18:00");
  const [minutes, setMinutes] = useState(60);
  const add = () => {
    const [h, m] = time.split(":").map(Number);
    void post({ action: "slot", subjectId, slot: { weekday, startMin: h * 60 + (m || 0), minutes } });
  };
  return (
    <div className="sv-add">
      <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
        {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
      </select>
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      <input type="number" min={5} max={600} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
      <button onClick={add} disabled={busy}>ADD SLOT</button>
    </div>
  );
}

function SessionAdd({ subject, post, busy }: { subject: Subject; post: (b: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [minutes, setMinutes] = useState(45);
  const [unitId, setUnitId] = useState<string>("");
  const [note, setNote] = useState("");
  const add = () => {
    void post({ action: "session", subjectId: subject.id, session: { minutes, unitId: unitId || null, note } });
    setNote("");
  };
  return (
    <div className="sv-add">
      <input type="number" min={1} max={600} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} title="Minutes" />
      <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
        <option value="">— whole subject —</option>
        {subject.units.map((u: Unit) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="WHAT YOU COVERED"
        onKeyDown={(e) => e.key === "Enter" && add()} />
      <button onClick={add} disabled={busy}>LOG</button>
    </div>
  );
}
