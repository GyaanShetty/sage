"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { AIR_CORRIDORS, CONFLICT_ZONES, TRADE_ROUTES, SAT_GROUPS, greatCircle } from "./data";
import { useLivePosition } from "@/lib/geo-position";
import { useLive } from "@/lib/live";
import { dueAt, type Place } from "@/core/places/schedule";

type L = typeof import("leaflet");
type LMap = import("leaflet").Map;
type LLayer = import("leaflet").LayerGroup;

interface LayerDef { key: string; label: string; icon: string; on: boolean; live?: boolean }

/** How far in the map will go. CARTO serves to 20; anything less is a choice,
 *  and 12 was the wrong one — see the tile layer below. */
const MAX_ZOOM = 20;

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

const CYAN = "#f4f5f7";

export function AtlasMap({ lat = 20, lon = 40, onZoomOut, center }: { lat?: number; lon?: number; onZoomOut?: () => void; center?: [number, number] }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const LRef = useRef<L | null>(null);
  const groups = useRef<Record<string, LLayer>>({});
  const [layers, setLayers] = useState<LayerDef[]>(INITIAL);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("BOOTING ATLAS…");
  const [conflictNews, setConflictNews] = useState<{ title: string; source: string; url: string }[]>([]);
  const [ticker, setTicker] = useState(0);

  // ── him, his places, and the way between them ────────────
  const { position, state: geoState } = useLivePosition();
  const [places, setPlaces] = useState<Place[]>([]);
  const [route, setRoute] = useState<{ meters: number; seconds: number; name: string } | null>(null);
  const meRef = useRef<LLayer | null>(null);
  const placeRef = useRef<LLayer | null>(null);
  // A polyline is a Layer, not a LayerGroup — the narrower type does not fit.
  const routeRef = useRef<import("leaflet").Layer | null>(null);

  useLive(
    () => fetch("/api/places").then((r) => r.json()).then((j) => setPlaces(j?.data ?? [])).catch(() => {}),
    { everyMs: 300_000, scopes: ["places"] },
  );

  // ── init map + static layers ─────────────────────────────
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default as unknown as L;
      if (disposed || !elRef.current) return;
      LRef.current = L;
      const map = L.map(elRef.current, { zoomControl: false, attributionControl: false, worldCopyJump: true, minZoom: 2 }).setView(center ?? [lat, lon], 5);
      mapRef.current = map;
      L.control.zoom({ position: "bottomright" }).addTo(map);
      // Zoom all the way out → hand back to the globe view.
      map.on("zoomend", () => { if (map.getZoom() <= 2 && onZoomOut) onZoomOut(); });
      /**
       * Street level, at last.
       *
       * This was maxZoom: 12 — roughly "a city fits on screen" — which is why
       * the atlas could never show a building, a junction, or the way to the
       * gym. CARTO's dark_all actually serves to z20, and the app already
       * proves it: features/dashboard/components/geo-map.tsx runs the very
       * same tiles at 19. The cap was arbitrary, not a provider limit.
       *
       * minZoom stays at 2 deliberately: the zoomend handler above uses
       * "zoom <= 2" to hand back to the globe, so lowering it would change
       * navigation rather than just widen the range.
       */
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", maxZoom: MAX_ZOOM }).addTo(map);

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
      // RainViewer only renders to ~z10; maxNativeZoom lets Leaflet upscale
      // its last real tile instead of dropping the layer when you zoom past it.
      if (j?.data?.url) { layer = L.tileLayer(j.data.url, { opacity: 0.6, maxZoom: MAX_ZOOM, maxNativeZoom: 10 }); layer.addTo(g); }
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
      { opacity: 0.7, maxZoom: MAX_ZOOM },
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
    // Fifteen minutes was the slowest timer in the app, and GDELT is cached
    // for fifteen more on the server — so this could show something half an
    // hour old with no way to ask for better. The timer stays (the upstream
    // does not move faster than that), but returning to the tab now refreshes.
    const t = setInterval(load, 900000);
    const onVisible = () => { if (!document.hidden) load(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready]);

  useEffect(() => {
    if (conflictNews.length < 2) return;
    const t = setInterval(() => setTicker((i) => (i + 1) % conflictNews.length), 6000);
    return () => clearInterval(t);
  }, [conflictNews]);

  /**
   * His position, drawn as a marker with its accuracy ring.
   *
   * The ring is not decoration: a 2km fix and a 5m fix mean very different
   * things, and a bare dot claims a precision the GPS did not provide.
   */
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map || !position) return;

    meRef.current?.remove();
    const g = L.layerGroup();
    L.circle([position.lat, position.lon], {
      radius: Math.max(position.accuracy, 12),
      color: "#e8a13a", weight: 1, fillColor: "#e8a13a", fillOpacity: 0.07,
    }).addTo(g);
    L.circleMarker([position.lat, position.lon], {
      radius: 4, color: "#0c0d0f", weight: 2, fillColor: "#e8a13a", fillOpacity: 1,
    }).bindTooltip(`YOU · ±${Math.round(position.accuracy)}m`, { direction: "top" }).addTo(g);
    g.addTo(map);
    meRef.current = g;
  }, [ready, position]);

  /** Saved places — always drawn, never behind a layer toggle. He asked for
   *  them to be "purely visible", and a place you have to switch on is not. */
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;

    placeRef.current?.remove();
    const g = L.layerGroup();
    for (const p of places) {
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: "atlas-place", html: `<i></i><span>${p.name}</span>`, iconSize: [0, 0] }),
      }).addTo(g);
    }
    g.addTo(map);
    placeRef.current = g;
  }, [ready, places]);

  /**
   * The route to wherever he is due to be.
   *
   * Drawn only when a place's window is open AND he is not already there —
   * directions to the gym while standing in the gym are noise.
   */
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map || !position) { setRoute(null); return; }

    const target = dueAt(places, new Date(), position);
    if (!target) { routeRef.current?.remove(); routeRef.current = null; setRoute(null); return; }

    let cancelled = false;
    const q = new URLSearchParams({
      fromLat: String(position.lat), fromLon: String(position.lon),
      toLat: String(target.lat), toLon: String(target.lon), profile: "driving",
    });
    fetch(`/api/route?${q}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.ok) return;
        routeRef.current?.remove();
        const line = L.polyline(j.data.points, { color: "#e8a13a", weight: 3, opacity: 0.85 });
        line.addTo(map);
        routeRef.current = line;
        setRoute({ meters: j.data.meters, seconds: j.data.seconds, name: target.name });
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // Recomputed when he moves far enough to matter, not on every GPS tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, places, Math.round((position?.lat ?? 0) * 500), Math.round((position?.lon ?? 0) * 500)]);

  /** Centre on him — the control every map has and this one did not. */
  const centreOnMe = () => {
    if (!position || !mapRef.current) return;
    mapRef.current.setView([position.lat, position.lon], Math.max(mapRef.current.getZoom(), 16), { animate: true });
  };

  // Re-center when the caller hands a new focus point (globe → map).
  useEffect(() => {
    if (!ready || !center || !mapRef.current) return;
    mapRef.current.setView(center, Math.max(4, mapRef.current.getZoom()), { animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, center?.[0], center?.[1]]);

  const toggle = (k: string) => setLayers((ls) => ls.map((l) => (l.key === k ? { ...l, on: !l.on } : l)));

  return (
    <div className="atlas">
      <div className="atlas-map" ref={elRef} />
      {/**
        * The toolbar sits ABOVE the map, not on it.
        *
        * It used to be `position: absolute` over the tiles, inset far enough
        * to clear the side rails — which meant the controls covered the thing
        * they control, and the map had to be tall enough to have room to
        * spare. Out of the way, the map gets all its space back.
        */}
      <div className="atlas-toolbar">
        <div className="rail">
          <span className="sig-dot on" />
          <span className="sig">ATLAS</span>
          <span className="k">{status}</span>
          <span className="sep" />
          {/* Position state, said plainly — "denied" is actionable, a missing
              dot is not. */}
          <span className="k">POS</span>
          <span className={geoState === "live" ? "sig" : "v"}>
            {geoState === "live" && position ? `±${Math.round(position.accuracy)}M` :
             geoState === "denied" ? "BLOCKED" :
             geoState === "locating" ? "ACQUIRING" : "OFF"}
          </span>
          {position && (
            <button className="atlas-chip" onClick={centreOnMe} title="Centre on my position">◎ ME</button>
          )}
        </div>

        <div className="atlas-layers">
          {layers.map((l) => (
            <button key={l.key} className={`atlas-chip${l.on ? " on" : ""}`} onClick={() => toggle(l.key)}>
              <span className="ac-ic">{l.icon}</span>{l.label}{l.live && <span className="ac-live" />}
            </button>
          ))}
        </div>

        {route && (
          <div className="rail">
            <span className="sig">ROUTE</span>
            <span className="v">{route.name.toUpperCase()}</span>
            <span className="sep" />
            <span className="v">{(route.meters / 1000).toFixed(1)} KM</span>
            <span className="v">{Math.round(route.seconds / 60)} MIN</span>
          </div>
        )}
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
