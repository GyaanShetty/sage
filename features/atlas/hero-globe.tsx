"use client";

import { useEffect, useRef, useState } from "react";
import { AIR_CORRIDORS, TRADE_ROUTES, CONFLICT_ZONES } from "./data";

// globe.gl instance is loosely typed here; it's a chainable builder.
type GlobeInstance = {
  (el: HTMLElement): GlobeInstance;
  width: (n: number) => GlobeInstance;
  height: (n: number) => GlobeInstance;
  backgroundColor: (c: string) => GlobeInstance;
  showGlobe: (b: boolean) => GlobeInstance;
  showGraticules: (b: boolean) => GlobeInstance;
  showAtmosphere: (b: boolean) => GlobeInstance;
  atmosphereColor: (c: string) => GlobeInstance;
  atmosphereAltitude: (n: number) => GlobeInstance;
  globeMaterial: () => { color: { set: (c: string) => void }; emissive?: { set: (c: string) => void }; emissiveIntensity?: number };
  hexPolygonsData: (d: unknown[]) => GlobeInstance;
  hexPolygonResolution: (n: number) => GlobeInstance;
  hexPolygonMargin: (n: number) => GlobeInstance;
  hexPolygonUseDots: (b: boolean) => GlobeInstance;
  hexPolygonColor: (fn: () => string) => GlobeInstance;
  arcsData: (d: unknown[]) => GlobeInstance;
  arcStartLat: (fn: (d: Arc) => number) => GlobeInstance;
  arcStartLng: (fn: (d: Arc) => number) => GlobeInstance;
  arcEndLat: (fn: (d: Arc) => number) => GlobeInstance;
  arcEndLng: (fn: (d: Arc) => number) => GlobeInstance;
  arcColor: (fn: (d: Arc) => string) => GlobeInstance;
  arcStroke: (n: number) => GlobeInstance;
  arcDashLength: (n: number) => GlobeInstance;
  arcDashGap: (n: number) => GlobeInstance;
  arcDashAnimateTime: (n: number) => GlobeInstance;
  arcLabel: (fn: (d: Arc) => string) => GlobeInstance;
  pointsData: (d: Pt[]) => GlobeInstance;
  pointLat: (fn: (d: Pt) => number) => GlobeInstance;
  pointLng: (fn: (d: Pt) => number) => GlobeInstance;
  pointColor: (fn: (d: Pt) => string) => GlobeInstance;
  pointAltitude: (fn: (d: Pt) => number) => GlobeInstance;
  pointRadius: (fn: (d: Pt) => number) => GlobeInstance;
  pointLabel: (fn: (d: Pt) => string) => GlobeInstance;
  pointsMerge: (b: boolean) => GlobeInstance;
  pointsTransitionDuration: (n: number) => GlobeInstance;
  controls: () => { autoRotate: boolean; autoRotateSpeed: number; enableZoom: boolean; minDistance: number; maxDistance: number; addEventListener?: (t: string, fn: () => void) => void };
  pointOfView: { (o: { lat?: number; lng?: number; altitude?: number }, ms?: number): GlobeInstance; (): { lat: number; lng: number; altitude: number } };
  _destructor?: () => void;
};
interface Arc { sLat: number; sLng: number; eLat: number; eLng: number; color: string; label: string }
interface Pt { lat: number; lng: number; color: string; alt: number; r: number; label: string }

interface LayerDef { key: string; label: string; icon: string; on: boolean; live?: boolean }
const INITIAL: LayerDef[] = [
  { key: "air", label: "FLIGHT ROUTES", icon: "✦", on: true },
  { key: "flights", label: "AIRCRAFT", icon: "✈", on: true, live: true },
  { key: "sats", label: "SATELLITES", icon: "🛰", on: true, live: true },
  { key: "trade", label: "TRADE LANES", icon: "⚓", on: false },
  { key: "conflict", label: "CONFLICTS", icon: "⚔", on: true },
  { key: "seismic", label: "SEISMIC", icon: "◈", on: false, live: true },
];

const CYAN = "#5ecfd6";
const COUNTRIES_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

export function HeroGlobe({ onZoomIn }: { nodeCount?: number; onZoomIn?: () => void }) {
  const elRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const [layers, setLayers] = useState<LayerDef[]>(INITIAL);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const dataRef = useRef<{ planes: Pt[]; sats: Pt[]; quakes: Pt[] }>({ planes: [], sats: [], quakes: [] });
  const [ready, setReady] = useState(false);

  const isOn = (k: string) => layersRef.current.find((l) => l.key === k)?.on ?? false;

  // build arc + point sets from current toggles + live data
  const rebuild = () => {
    const g = globeRef.current;
    if (!g) return;
    const arcs: Arc[] = [];
    if (isOn("air")) for (const c of AIR_CORRIDORS) arcs.push({ sLat: c.from[0], sLng: c.from[1], eLat: c.to[0], eLng: c.to[1], color: CYAN, label: `✦ ${c.name}` });
    if (isOn("trade")) for (const t of TRADE_ROUTES) for (let i = 0; i < t.path.length - 1; i++) arcs.push({ sLat: t.path[i][0], sLng: t.path[i][1], eLat: t.path[i + 1][0], eLng: t.path[i + 1][1], color: "#f4f4f5", label: `⚓ ${t.name}` });
    g.arcsData(arcs);

    const pts: Pt[] = [];
    if (isOn("flights")) pts.push(...dataRef.current.planes);
    if (isOn("sats")) pts.push(...dataRef.current.sats);
    if (isOn("seismic")) pts.push(...dataRef.current.quakes);
    if (isOn("conflict")) for (const z of CONFLICT_ZONES) pts.push({ lat: z.at[0], lng: z.at[1], color: "#e0706a", alt: 0.01, r: 0.4 + z.intensity * 0.18, label: `⚔ ${z.name} (indicative)` });
    g.pointsData(pts);
  };

  // ── init ─────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    (async () => {
      const [{ default: Globe }, topojson] = await Promise.all([
        import("globe.gl"),
        import("topojson-client").catch(() => null),
      ]);
      if (disposed || !elRef.current) return;
      const el = elRef.current;
      const world = (new (Globe as unknown as new () => GlobeInstance)())(el)
        .backgroundColor("rgba(0,0,0,0)")
        .showGlobe(true)
        .showGraticules(true)
        .showAtmosphere(true)
        .atmosphereColor(CYAN)
        .atmosphereAltitude(0.16)
        .arcStroke(0.5)
        .arcDashLength(0.4)
        .arcDashGap(0.6)
        .arcDashAnimateTime(2600)
        .arcColor((d) => d.color)
        .arcStartLat((d) => d.sLat).arcStartLng((d) => d.sLng).arcEndLat((d) => d.eLat).arcEndLng((d) => d.eLng)
        .arcLabel((d) => d.label)
        .pointLat((d) => d.lat).pointLng((d) => d.lng).pointColor((d) => d.color).pointAltitude((d) => d.alt).pointRadius((d) => d.r).pointLabel((d) => d.label)
        .pointsMerge(false)
        .pointsTransitionDuration(0);
      globeRef.current = world;

      const mat = world.globeMaterial();
      mat.color.set("#0d1013");
      if (mat.emissive) { mat.emissive.set("#0a1214"); mat.emissiveIntensity = 0.28; }

      // dark hex-dot continents from world-atlas topojson
      try {
        const res = await fetch(COUNTRIES_URL);
        const topo = await res.json();
        const feats = topojson && topo?.objects?.countries
          ? ((topojson.feature(topo, topo.objects.countries) as unknown) as { features: unknown[] }).features
          : [];
        world.hexPolygonsData(feats).hexPolygonResolution(3).hexPolygonMargin(0.28).hexPolygonUseDots(true).hexPolygonColor(() => "rgba(94,207,214,0.6)");
      } catch {}

      const size = () => { world.width(el.clientWidth).height(el.clientHeight); };
      size();
      const ro = new ResizeObserver(size);
      ro.observe(el);

      const ctr = world.controls();
      ctr.autoRotate = true;
      ctr.autoRotateSpeed = 0.32;
      ctr.enableZoom = true;
      ctr.minDistance = 115;
      ctr.maxDistance = 480;
      world.pointOfView({ lat: 18, lng: 78, altitude: 2.05 }, 0);
      el.addEventListener("pointerdown", () => { ctr.autoRotate = false; });

      // Dive past a threshold → hand off to the flat map view.
      let handed = false;
      ctr.addEventListener?.("change", () => {
        const alt = world.pointOfView().altitude ?? 2;
        if (alt < 0.62 && !handed) { handed = true; onZoomIn?.(); }
        if (alt > 0.9) handed = false;
      });

      setReady(true);
      rebuild();
      return () => { ro.disconnect(); world._destructor?.(); };
    })();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── live data feeds ──────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const loadPlanes = async () => {
      try {
        const j = await fetch("/api/sky").then((r) => r.json());
        dataRef.current.planes = (j?.data?.planes ?? []).map((p: { lat: number; lon: number; callsign: string; origin: string; alt: number }) => ({
          lat: p.lat, lng: p.lon, color: "rgba(244,244,245,0.85)", alt: 0.02, r: 0.28, label: `✈ ${p.callsign} · ${p.origin}`,
        }));
      } catch {}
      if (!stop) rebuild();
    };
    const loadSats = async () => {
      const out: Pt[] = [];
      for (const grp of ["stations", "visual"]) {
        try {
          const j = await fetch(`/api/atlas/satellites?group=${grp}`).then((r) => r.json());
          for (const s of j?.data ?? []) out.push({ lat: s.lat, lng: s.lon, color: /ISS|ZARYA/i.test(s.name) ? CYAN : "#cfd6d8", alt: 0.14, r: /ISS/i.test(s.name) ? 0.55 : 0.3, label: `🛰 ${s.name} · ${s.alt}km` });
        } catch {}
      }
      dataRef.current.sats = out;
      if (!stop) rebuild();
    };
    const loadQuakes = async () => {
      try {
        const j = await fetch("/api/atlas/seismic").then((r) => r.json());
        dataRef.current.quakes = (j?.data ?? []).map((q: { lat: number; lon: number; mag: number; place: string }) => ({ lat: q.lat, lng: q.lon, color: "#e8a13a", alt: 0.01, r: 0.2 + q.mag * 0.12, label: `◈ M${q.mag.toFixed(1)} · ${q.place}` }));
      } catch {}
      if (!stop) rebuild();
    };
    loadPlanes(); loadSats(); loadQuakes();
    const t1 = setInterval(loadPlanes, 20000);
    const t2 = setInterval(loadSats, 5000);
    const t3 = setInterval(loadQuakes, 300000);
    return () => { stop = true; clearInterval(t1); clearInterval(t2); clearInterval(t3); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => { rebuild(); /* eslint-disable-next-line */ }, [layers]);

  const toggle = (k: string) => setLayers((ls) => ls.map((l) => (l.key === k ? { ...l, on: !l.on } : l)));

  return (
    <div className="heroglobe">
      <div className="heroglobe-canvas" ref={elRef} />
      <div className="heroglobe-layers">
        {layers.map((l) => (
          <button key={l.key} className={`atlas-chip${l.on ? " on" : ""}`} onClick={() => toggle(l.key)}>
            <span className="ac-ic">{l.icon}</span>{l.label}{l.live && <span className="ac-live" />}
          </button>
        ))}
      </div>
      <div className="heroglobe-hint">DRAG TO ROTATE · SCROLL TO ZOOM IN · HOVER TO IDENTIFY</div>
    </div>
  );
}
