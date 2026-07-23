"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { AIR_CORRIDORS, CONFLICT_ZONES, TRADE_ROUTES, SAT_GROUPS, greatCircle } from "./data";

type L = typeof import("leaflet");
type LMap = import("leaflet").Map;
type LLayer = import("leaflet").LayerGroup;

interface LayerDef { key: string; label: string; icon: string; on: boolean; live?: boolean }

const HAS_TRAFFIC = !!process.env.NEXT_PUBLIC_TOMTOM_KEY;

const INITIAL: LayerDef[] = [
  { key: "flights", label: "FLIGHTS", icon: "✈", on: true, live: true },
  { key: "air", label: "AIR ROUTES", icon: "✦", on: true },
  { key: "sats", label: "SATELLITES", icon: "🛰", on: true, live: true },
  { key: "rain", label: "RAIN RADAR", icon: "🌧", on: false, live: true },
  { key: "trade", label: "TRADE LANES", icon: "⚓", on: true },
  { key: "conflict", label: "CONFLICTS", icon: "⚔", on: true, live: true },
  { key: "seismic", label: "SEISMIC", icon: "◈", on: false, live: true },
  ...(HAS_TRAFFIC ? [{ key: "traffic", label: "TRAFFIC", icon: "🚦", on: false, live: true }] : []),
];

const CYAN = "#5ecfd6";

export function AtlasMap({ lat = 20, lon = 40 }: { lat?: number; lon?: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const LRef = useRef<L | null>(null);
  const groups = useRef<Record<string, LLayer>>({});
  const [layers, setLayers] = useState<LayerDef[]>(INITIAL);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("BOOTING ATLAS…");
  const [conflictNews, setConflictNews] = useState<{ title: string; source: string; url: string }[]>([]);
  const [ticker, setTicker] = useState(0);

  // ── init map + static layers ─────────────────────────────
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default as unknown as L;
      if (disposed || !elRef.current) return;
      LRef.current = L;
      const map = L.map(elRef.current, { zoomControl: false, attributionControl: false, worldCopyJump: true, minZoom: 2 }).setView([lat, lon], 3);
      mapRef.current = map;
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", maxZoom: 12 }).addTo(map);

      // group containers
      for (const d of INITIAL) groups.current[d.key] = L.layerGroup();

      // air corridors (static great-circle arcs)
      for (const c of AIR_CORRIDORS) {
        L.polyline(greatCircle(c.from, c.to), { color: CYAN, weight: 1, opacity: 0.35, dashArray: "1 5" })
          .bindTooltip(`✦ ${c.name}`, { sticky: true })
          .addTo(groups.current.air);
      }
      // trade lanes (static)
      for (const t of TRADE_ROUTES) {
        L.polyline(t.path, { color: "#f4f4f5", weight: 1, opacity: 0.28 })
          .bindTooltip(`⚓ ${t.name}`, { sticky: true })
          .addTo(groups.current.trade);
      }
      // conflict zones (static, indicative)
      for (const z of CONFLICT_ZONES) {
        L.circleMarker(z.at, { radius: 5 + z.intensity * 3, color: "#e0706a", weight: 1, fillColor: "#e0706a", fillOpacity: 0.12 })
          .bindTooltip(`⚔ ${z.name} · tension ${z.intensity}/3 (indicative)`, { sticky: true })
          .addTo(groups.current.conflict);
      }

      // add initially-on groups
      for (const d of INITIAL) if (d.on) groups.current[d.key].addTo(map);

      setReady(true);
      setStatus("ATLAS ONLINE");
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── toggle groups on/off ─────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const d of layers) {
      const g = groups.current[d.key];
      if (!g) continue;
      if (d.on && !map.hasLayer(g)) g.addTo(map);
      if (!d.on && map.hasLayer(g)) map.removeLayer(g);
    }
  }, [layers, ready]);

  const isOn = (k: string) => layers.find((l) => l.key === k)?.on ?? false;

  // ── live flights ─────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const load = async () => {
      if (stop || !isOn("flights")) return;
      const L = LRef.current!;
      const g = groups.current.flights;
      try {
        const j = await fetch(`/api/sky?lat=${lat}&lon=${lon}`).then((r) => r.json());
        const planes = j?.data?.planes ?? [];
        g.clearLayers();
        for (const p of planes) {
          L.marker([p.lat, p.lon], {
            icon: L.divIcon({ className: "atlas-plane", html: `<div style="transform:rotate(${p.heading}deg)">▲</div>`, iconSize: [12, 12] }),
          })
            .bindTooltip(`✈ ${p.callsign} · ${p.origin} · ${Math.round(p.alt)}m · ${Math.round(p.vel * 3.6)}km/h`, { sticky: true })
            .addTo(g);
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 20000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layers, lat, lon]);

  // ── live satellites (positions propagated server-side) ───
  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const L = LRef.current!;
    const g = groups.current.sats;
    const markers = new Map<string, import("leaflet").Marker>();
    const load = async () => {
      if (stop || !isOn("sats")) return;
      const all: { name: string; lat: number; lon: number; alt: number }[] = [];
      for (const grp of SAT_GROUPS) {
        try {
          const j = await fetch(`/api/atlas/satellites?group=${grp}`).then((r) => r.json());
          for (const s of j?.data ?? []) all.push(s);
        } catch {}
      }
      for (const s of all) {
        const isISS = /ISS|ZARYA/i.test(s.name);
        let m = markers.get(s.name);
        if (!m) {
          m = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: `atlas-sat${isISS ? " iss" : ""}`, html: isISS ? "◆" : "•", iconSize: [10, 10] }) })
            .bindTooltip(`🛰 ${s.name} · ${s.alt}km`, { sticky: true })
            .addTo(g);
          markers.set(s.name, m);
        } else {
          m.setLatLng([s.lat, s.lon]);
        }
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layers]);

  // ── rain radar tiles ─────────────────────────────────────
  useEffect(() => {
    if (!ready || !isOn("rain")) return;
    const L = LRef.current!;
    const g = groups.current.rain;
    let layer: import("leaflet").TileLayer | null = null;
    fetch("/api/atlas/rain").then((r) => r.json()).then((j) => {
      if (j?.data?.url) { layer = L.tileLayer(j.data.url, { opacity: 0.6, maxZoom: 12 }); layer.addTo(g); }
    }).catch(() => {});
    return () => { if (layer) g.removeLayer(layer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layers]);

  // ── traffic tiles (TomTom, needs key) ────────────────────
  useEffect(() => {
    if (!ready || !HAS_TRAFFIC || !isOn("traffic")) return;
    const L = LRef.current!;
    const g = groups.current.traffic;
    const key = process.env.NEXT_PUBLIC_TOMTOM_KEY;
    const layer = L.tileLayer(
      `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${key}`,
      { opacity: 0.7, maxZoom: 12 },
    );
    layer.addTo(g);
    return () => { g.removeLayer(layer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layers]);

  // ── live seismic (USGS earthquakes) ──────────────────────
  useEffect(() => {
    if (!ready || !isOn("seismic")) return;
    const L = LRef.current!;
    const g = groups.current.seismic;
    let stop = false;
    const load = async () => {
      if (stop) return;
      try {
        const j = await fetch("/api/atlas/seismic").then((r) => r.json());
        g.clearLayers();
        for (const q of j?.data ?? []) {
          L.circleMarker([q.lat, q.lon], { radius: 2 + q.mag * 1.6, color: "#e8a13a", weight: 1, fillColor: "#e8a13a", fillOpacity: 0.15 })
            .bindTooltip(`◈ M${q.mag.toFixed(1)} · ${q.place} · ${new Date(q.time).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })} IST`, { sticky: true })
            .addTo(g);
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 300000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layers]);

  // ── live conflict headlines (GDELT) for the HUD ticker ────
  useEffect(() => {
    if (!ready) return;
    const load = () => fetch("/api/atlas/conflicts").then((r) => r.json()).then((j) => setConflictNews(j?.data ?? [])).catch(() => {});
    load();
    const t = setInterval(load, 900000);
    return () => clearInterval(t);
  }, [ready]);

  useEffect(() => {
    if (conflictNews.length < 2) return;
    const t = setInterval(() => setTicker((i) => (i + 1) % conflictNews.length), 6000);
    return () => clearInterval(t);
  }, [conflictNews]);

  const toggle = (k: string) => setLayers((ls) => ls.map((l) => (l.key === k ? { ...l, on: !l.on } : l)));

  return (
    <div className="atlas">
      <div className="atlas-map" ref={elRef} />
      <div className="atlas-hud">
        <div className="atlas-title"><span className="live-dot" /> ATLAS · {status}</div>
        <div className="atlas-layers">
          {layers.map((l) => (
            <button key={l.key} className={`atlas-chip${l.on ? " on" : ""}`} onClick={() => toggle(l.key)}>
              <span className="ac-ic">{l.icon}</span>{l.label}{l.live && <span className="ac-live" />}
            </button>
          ))}
        </div>
        <div className="atlas-note">HOVER ANY OBJECT TO IDENTIFY · DRAG TO PAN · SCROLL TO ZOOM</div>
      </div>
      {isOn("conflict") && conflictNews.length > 0 && (
        <a className="atlas-ticker" href={conflictNews[ticker]?.url ?? "#"} target="_blank" rel="noreferrer">
          <span className="at-tag">⚔ LIVE</span>
          <span className="at-txt" key={ticker}>{conflictNews[ticker]?.title}</span>
        </a>
      )}
    </div>
  );
}
