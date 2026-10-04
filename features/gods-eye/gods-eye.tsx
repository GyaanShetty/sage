"use client";

/**
 * God's Eye.
 *
 * After bilawalsidhu/gods-eye-view, whose premise is the good one and worth
 * restating: seismographs, aircraft transponders, orbital elements and
 * hurricane advisories are all published openly, and the only thing missing is
 * somewhere to see them at once. This is that, built on SAGE's own map and its
 * existing satellite and aircraft routes.
 *
 * A full-bleed map with the readout over it rather than beside it — the point
 * of this screen is the planet, so nothing is allowed to take width from it.
 * Layers toggle; the HUD counts what is on; clicking a row flies to it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Activity, Wind, Rocket, Plane, Satellite, Radio } from "lucide-react";
import { asArray } from "@/lib/as-array";
import { TZ } from "@/lib/config";
import "./gods-eye.css";

const EyeMap = dynamic(() => import("./eye-map").then((m) => m.EyeMap), { ssr: false });

export interface Quake { id: string; mag: number; place: string; lat: number; lon: number; depth: number; at: number; url: string; tsunami: boolean }
export interface Storm { id: string; name: string; classification: string; lat: number; lon: number; intensityKt: number | null; pressureMb: number | null; movement: string | null }
export interface Launch { id: string; name: string; provider: string; at: string; pad: string; country: string; status: string }

export type LayerKey = "quakes" | "storms" | "aircraft" | "sats";

const hhmm = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));

/** "in 3h", "in 2d" — a countdown you can read without doing the subtraction. */
function until(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 0) return "now";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export function GodsEye() {
  const [data, setData] = useState<{ quakes: Quake[]; storms: Storm[]; launches: Launch[]; down: string[] } | null>(null);
  const [sky, setSky] = useState<{ tracked: number; airborne: number } | null>(null);
  const [on, setOn] = useState<Record<LayerKey, boolean>>({ quakes: true, storms: true, aircraft: true, sats: true });
  const [focus, setFocus] = useState<{ lat: number; lon: number; zoom?: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    fetch("/api/gods-eye", { signal: AbortSignal.timeout(25_000) })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setData(j.data); })
      .catch(() => {});
    fetch("/api/skies", { signal: AbortSignal.timeout(25_000) })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setSky(j.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    /* Two minutes, and only while the tab is watched — this is four upstreams
       and none of them move faster than that. */
    const start = () => { if (!timer.current) timer.current = setInterval(load, 120_000); };
    const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
    const vis = () => { if (document.hidden) stop(); else { load(); start(); } };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", vis);
    return () => { stop(); document.removeEventListener("visibilitychange", vis); };
  }, [load]);

  const quakes = useMemo(() => asArray<Quake>(data?.quakes), [data]);
  const storms = useMemo(() => asArray<Storm>(data?.storms), [data]);
  const launches = useMemo(() => asArray<Launch>(data?.launches), [data]);

  const toggle = (k: LayerKey) => setOn((o) => ({ ...o, [k]: !o[k] }));

  const LAYERS: { key: LayerKey; label: string; icon: typeof Activity; count: string }[] = [
    { key: "quakes", label: "Seismic", icon: Activity, count: String(quakes.length) },
    { key: "storms", label: "Cyclones", icon: Wind, count: String(storms.length) },
    { key: "aircraft", label: "Aircraft", icon: Plane, count: sky ? sky.airborne.toLocaleString() : "—" },
    { key: "sats", label: "Satellites", icon: Satellite, count: "live" },
  ];

  return (
    <div className="ge">
      <EyeMap
        quakes={on.quakes ? quakes : []}
        storms={on.storms ? storms : []}
        showAircraft={on.aircraft}
        showSats={on.sats}
        focus={focus}
      />

      <div className="ge-hud">
        <header className="ge-head">
          <h1 className="ge-title">God&rsquo;s Eye</h1>
          <p className="ge-sub">
            Every public signal, at once. {data ? `Updated ${hhmm(Date.now())}` : "Acquiring…"}
          </p>
          {!!data?.down.length && (
            <p className="ge-down">
              <Radio className="size-3" /> {data.down.join(", ")} not answering
            </p>
          )}
        </header>

        <div className="ge-layers">
          {LAYERS.map((l) => (
            <button
              key={l.key}
              className={`ge-layer${on[l.key] ? " on" : ""}`}
              onClick={() => toggle(l.key)}
              aria-pressed={on[l.key]}
            >
              <l.icon className="size-3.5" />
              <span className="ge-lname">{l.label}</span>
              <span className="ge-lcount num">{l.count}</span>
            </button>
          ))}
        </div>

        <section className="ge-list">
          <h2>Seismic · 24h</h2>
          {quakes.length === 0 && <p className="ge-quiet">Nothing above magnitude 2.5.</p>}
          {quakes.slice(0, 14).map((q) => (
            <button key={q.id} className="ge-row" onClick={() => setFocus({ lat: q.lat, lon: q.lon, zoom: 6 })}>
              {/* The magnitude is the whole story, so it gets the weight and a
                  width that makes a column of them comparable. */}
              <span className={`ge-mag num${q.mag >= 5 ? " big" : ""}`}>{q.mag.toFixed(1)}</span>
              <span className="ge-rmain">
                <span className="ge-rt">{q.place}</span>
                <span className="ge-rs">{Math.round(q.depth)} km deep · {hhmm(q.at)}{q.tsunami ? " · tsunami" : ""}</span>
              </span>
            </button>
          ))}
        </section>

        {storms.length > 0 && (
          <section className="ge-list">
            <h2>Cyclones</h2>
            {storms.map((s) => (
              <button key={s.id} className="ge-row" onClick={() => setFocus({ lat: s.lat, lon: s.lon, zoom: 5 })}>
                <span className="ge-mag num">{s.intensityKt ?? "—"}</span>
                <span className="ge-rmain">
                  <span className="ge-rt">{s.name}</span>
                  <span className="ge-rs">{s.classification}{s.movement ? ` · ${s.movement}` : ""}</span>
                </span>
              </button>
            ))}
          </section>
        )}

        <section className="ge-list">
          <h2>Next off the pad</h2>
          {launches.length === 0 && <p className="ge-quiet">No upcoming launches listed.</p>}
          {launches.slice(0, 8).map((l) => (
            <div key={l.id} className="ge-row static">
              <span className="ge-mag num">{until(l.at)}</span>
              <span className="ge-rmain">
                <span className="ge-rt">{l.name}</span>
                <span className="ge-rs">{l.provider} · {l.pad}</span>
              </span>
            </div>
          ))}
        </section>

        <footer className="ge-foot">
          <Rocket className="size-3" /> USGS · NOAA NHC · The Space Devs · OpenSky · Celestrak
        </footer>
      </div>
    </div>
  );
}
