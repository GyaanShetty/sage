"use client";

/**
 * The two columns either side of the wordmark.
 *
 * The band was a name floating in a very wide empty box. These fill it with
 * readings rather than with ornament — everything here is measured, and the
 * ASCII meter is just how it is drawn.
 *
 * Left is time: how far through the day, the week, the quarter and the year
 * you are. Nothing else on the wall says that, and it is the context every
 * other number on the screen is implicitly measured against.
 *
 * Right is the machine: frame rate, link, power, heap — the same readings the
 * systems panel takes, surfaced where you will actually glance at them.
 */

import { useEffect, useState } from "react";
import { AsciiMeter } from "@/components/ascii/motifs";
import { readDevice, sampleFps, type DeviceReading } from "@/lib/device";
import { TZ } from "@/lib/config";

function Line({ k, pct, read }: { k: string; pct: number | null; read: string }) {
  return (
    <div className="dhf-line">
      <span className="dhf-k">{k}</span>
      {/* A meter with nothing behind it draws empty rather than at zero —
          zero is a measurement and "no reading" is not. */}
      <AsciiMeter value={pct ?? 0} width={14} className={pct === null ? "is-void" : undefined} />
      <span className="dhf-v">{read}</span>
    </div>
  );
}

/** Elapsed fractions, in the app's timezone rather than the machine's. */
function elapsed() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const y = g("year"), mo = g("month"), d = g("day");
  const hh = g("hour") % 24, mm = g("minute"), ss = g("second");

  const day = (hh * 3600 + mm * 60 + ss) / 86400;

  // Monday-first week index from the IST date, not the local one.
  const dow = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
  const week = (dow + day) / 7;

  const qStart = Math.floor((mo - 1) / 3) * 3;                     // 0, 3, 6, 9
  const qDays = (Date.UTC(y, qStart + 3, 1) - Date.UTC(y, qStart, 1)) / 86400000;
  const intoQ = (Date.UTC(y, mo - 1, d) - Date.UTC(y, qStart, 1)) / 86400000;
  const quarter = (intoQ + day) / qDays;

  const yDays = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000;
  const intoY = (Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 1)) / 86400000;
  const year = (intoY + day) / yDays;

  return { day, week, quarter, year };
}

const pc = (f: number) => `${Math.round(f * 100)}%`;

export function HeroTime() {
  const [e, setE] = useState<ReturnType<typeof elapsed> | null>(null);
  useEffect(() => {
    const tick = () => setE(elapsed());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="dhf dhf-l">
      <span className="dhf-cap">ELAPSED</span>
      <Line k="DAY" pct={e?.day ?? null} read={e ? pc(e.day) : "—"} />
      <Line k="WEEK" pct={e?.week ?? null} read={e ? pc(e.week) : "—"} />
      <Line k="QTR" pct={e?.quarter ?? null} read={e ? pc(e.quarter) : "—"} />
      <Line k="YEAR" pct={e?.year ?? null} read={e ? pc(e.year) : "—"} />
    </div>
  );
}

export function HeroMachine() {
  const [d, setD] = useState<Omit<DeviceReading, "fps"> | null>(null);
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = () => { void readDevice().then((r) => { if (alive) setD(r); }); };
    pull();
    const id = setInterval(pull, 10_000);
    const stop = sampleFps((f) => alive && setFps(f));
    return () => { alive = false; clearInterval(id); stop(); };
  }, []);

  const heap = d?.heapUsed != null && d?.heapLimit ? d.heapUsed / d.heapLimit : null;
  // 25 Mb/s is a full bar, not a maximum — the reading beside it is the truth.
  const link = d?.downlinkMbps == null ? null : Math.min(1, d.downlinkMbps / 25);

  return (
    <div className="dhf dhf-r">
      <span className="dhf-cap">MACHINE</span>
      <Line k="FRAME" pct={fps === null ? null : Math.min(1, fps / 60)} read={fps === null ? "—" : `${fps}FPS`} />
      <Line k="LINK" pct={link} read={d?.downlinkMbps != null ? `${d.downlinkMbps}Mb` : "—"} />
      <Line k="POWER" pct={d?.battery ?? null} read={d?.battery == null ? "—" : `${Math.round(d.battery * 100)}%`} />
      <Line k="HEAP" pct={heap} read={d?.heapUsed != null ? `${Math.round(d.heapUsed / 1048576)}MB` : "—"} />
    </div>
  );
}
