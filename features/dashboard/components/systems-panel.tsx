"use client";

/**
 * Systems: four gauges and the link, from readings the browser actually has.
 *
 * The reference shows CPU / GPU / MEMORY / STORAGE. Two of those a web page
 * genuinely cannot see, so it shows what it can: the JavaScript heap this app
 * is holding, the storage it has taken of what it was granted, the frame rate
 * it is rendering at, and the battery. A gauge with no reading behind it
 * renders as "—" rather than as a number, because a dial that always shows
 * something is a dial you stop believing.
 */

import { useEffect, useState } from "react";
import { Pane } from "@/components/pane";
import { readDevice, sampleFps, type DeviceReading } from "@/lib/device";
import { AsciiWave } from "@/components/ascii/motifs";

const mb = (b: number) => `${(b / 1048576).toFixed(0)}MB`;
const gb = (b: number) => `${(b / 1073741824).toFixed(1)}GB`;

function Gauge({ label, pct, read, tone }: {
  label: string; pct: number | null; read: string; tone?: string;
}) {
  return (
    <div className="sysg">
      <div className="sysg-dial" style={tone ? ({ ["--g" as string]: tone }) : undefined}>
        <svg viewBox="0 0 40 40" aria-hidden>
          <circle className="sysg-bg" cx="20" cy="20" r="16" />
          {pct !== null && (
            <circle
              className="sysg-fg" cx="20" cy="20" r="16"
              strokeDasharray={`${Math.max(0, Math.min(100, pct)) * 1.005} 200`}
            />
          )}
        </svg>
        {/* A live heap of 11MB against a 4GB ceiling really is 0.3%, and
            rounding that to "0%" makes a working dial look broken. Under one
            per cent it keeps a decimal. */}
        <b>{pct === null ? "—" : `${pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`}</b>
      </div>
      <span className="sysg-k">{label}</span>
      <span className="sysg-v">{read}</span>
    </div>
  );
}

export function SystemsPanel({ n }: { n?: number }) {
  const [d, setD] = useState<Omit<DeviceReading, "fps"> | null>(null);
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = () => { void readDevice().then((r) => { if (alive) setD(r); }); };
    pull();
    const id = setInterval(pull, 5000);
    const stopFps = sampleFps((f) => alive && setFps(f));
    return () => { alive = false; clearInterval(id); stopFps(); };
  }, []);

  const heapPct = d?.heapUsed != null && d?.heapLimit ? (d.heapUsed / d.heapLimit) * 100 : null;
  const storePct = d?.storeUsed != null && d?.storeQuota ? (d.storeUsed / d.storeQuota) * 100 : null;
  // 60 is the reference frame budget; above it the bar simply pins.
  const fpsPct = fps === null ? null : Math.min(100, (fps / 60) * 100);
  const batPct = d?.battery == null ? null : d.battery * 100;

  return (
    <Pane n={n} title="Systems" status={d ? "MEASURED" : "READING"} live={!!d}>
      <div className="sys">
        <div className="sys-dials">
          <Gauge label="HEAP" pct={heapPct} tone="var(--cyan)"
            read={d?.heapUsed != null ? mb(d.heapUsed) : "not exposed"} />
          <Gauge label="STORE" pct={storePct} tone="var(--amber)"
            read={d?.storeUsed != null ? mb(d.storeUsed) : "not exposed"} />
          <Gauge label="FRAME" pct={fpsPct} tone="var(--up)"
            read={fps === null ? "—" : `${fps} FPS`} />
          <Gauge label="POWER" pct={batPct} tone={d?.charging ? "var(--up)" : "var(--foreground)"}
            read={d?.battery == null ? "not exposed" : d.charging ? "charging" : "on battery"} />
        </div>

        <div className="sys-net">
          <span className="sys-net-k">
            LINK <AsciiWave width={10} />
          </span>
          <span className="sys-net-v">
            {d?.downlinkMbps != null ? `${d.downlinkMbps} Mb/s` : "—"}
            {d?.netKind ? ` · ${d.netKind.toUpperCase()}` : ""}
            {d?.rtt != null ? ` · ${d.rtt}ms` : ""}
          </span>
        </div>

        <div className="sys-rows">
          <span><i>CORES</i><b>{d?.cores ?? "—"}</b></span>
          <span><i>DEVICE RAM</i><b>{d?.ramGb ? `${d.ramGb}GB` : "—"}</b></span>
          <span><i>QUOTA</i><b>{d?.storeQuota ? gb(d.storeQuota) : "—"}</b></span>
        </div>
      </div>
    </Pane>
  );
}
