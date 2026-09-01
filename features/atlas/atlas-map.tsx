"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { AIR_CORRIDORS, CONFLICT_ZONES, TRADE_ROUTES, SAT_GROUPS, greatCircle } from "./data";
import { useLivePosition } from "@/lib/geo-position";
import { useLive, notifyDataChanged } from "@/lib/live";
import { dueAt, type Place } from "@/core/places/schedule";
import { asArray } from "@/lib/as-array";

type L = typeof import("leaflet");
type LMap = import("leaflet").Map;
type LLayer = import("leaflet").LayerGroup;

interface LayerDef { key: string; label: string; icon: string; on: boolean; live?: boolean }

/** How far in the map will go. OpenStreetMap's standard raster serves to 19 —
 *  building level. The old cap of 12 was roughly "a city fits on screen", which
 *  is why the atlas could never show a junction or the way to the gym. */
const MAX_ZOOM = 19;

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
  /** A spot he right-clicked, waiting to be named. */
  const [pending, setPending] = useState<{ lat: number; lon: number } | null>(null);
  const [placeName, setPlaceName] = useState("");
  /** Find-a-place. Nominatim, debounced, biased to the current centre. */
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ name: string; lat: number; lon: number }[]>([]);
  const [seeking, setSeeking] = useState(false);
  /** A place he asked to be routed to, overriding the scheduled one. */
  const [pinned, setPinned] = useState<Place | null>(null);
  const meRef = useRef<LLayer | null>(null);
  /** Whether the map has already jumped to him once. A ref, not state:
   *  watchPosition fires continuously, and re-centring on every tick would
   *  yank the map out from under him the moment he panned anywhere. */
  const centredRef = useRef(false);
  const placeRef = useRef<LLayer | null>(null);
  // A polyline is a Layer, not a LayerGroup — the narrower type does not fit.
  const routeRef = useRef<import("leaflet").Layer | null>(null);

  useLive(
    () => fetch("/api/places").then((r) => r.json()).then((j) => setPlaces(asArray<Place>(j?.data))).catch(() => {}),
    { everyMs: 300_000, scopes: ["places"] },
  );

  /**
   * Search, debounced.
   *
   * Nominatim asks for at most a request a second, and typing produces far
   * more than that — so the query settles for 400ms before anything is sent,
   * and an in-flight search is abandoned when a newer one starts rather than
   * being allowed to land out of order over a fresher result.
   */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setHits([]); setSeeking(false); return; }
    setSeeking(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const c = mapRef.current?.getCenter();
      const near = c ? `&lat=${c.lat}&lon=${c.lng}` : "";
      fetch(`/api/geocode?q=${encodeURIComponent(q)}${near}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => setHits(asArray(j?.data)))
        .catch(() => {})
        .finally(() => setSeeking(false));
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);

  // ── init map + static layers ─────────────────────────────
  useEffect(() => {
    let disposed = false;
    (async () => {
      /**
       * Wrapped, because an async IIFE that throws does so into the void.
       *
       * Everything below runs inside a promise nobody awaits, so any failure —
       * a bad import, a container with no size, Leaflet objecting to being
       * initialised twice — became an unhandled rejection and the status text
       * simply sat on "BOOTING ATLAS…" forever. A map that fails silently is
       * indistinguishable from a map that is merely slow, which is the worst
       * possible thing to debug.
       */
      try {
      // Progressive boot states. "BOOTING ATLAS…" for ten seconds tells you
      // nothing about which of these steps is the slow or broken one.
      setStatus("LOADING LEAFLET…");
      const mod = await import("leaflet");
      setStatus("BUILDING MAP…");
      // Leaflet's ESM build exposes the API on `default` in some bundlers and
      // at the top level in others; taking one and hoping is how this ends up
      // throwing "L.map is not a function" with no clue why.
      const L = ((mod as unknown as { default?: unknown }).default ?? mod) as unknown as L;
      if (disposed) return;
      if (!elRef.current) { setStatus("MAP CONTAINER MISSING"); return; }
      LRef.current = L;
      const map = L.map(elRef.current, { zoomControl: false, attributionControl: false, worldCopyJump: true, minZoom: 2 }).setView(center ?? [lat, lon], 5);
      mapRef.current = map;
      L.control.zoom({ position: "bottomright" }).addTo(map);
      // Zoom all the way out → hand back to the globe view.
      map.on("zoomend", () => { if (map.getZoom() <= 2 && onZoomOut) onZoomOut(); });

      /**
       * Right-click to save a spot.
       *
       * Registered here, in the init effect, so it binds exactly once — a
       * separate effect would need its own `ready` guard and a `map.off`
       * cleanup, and would rebind on every dependency change.
       *
       * The prompt is deliberately plain. A place is a name and a point; the
       * schedule that makes it useful is set afterwards in the panel, where
       * there is room for two time fields and seven day toggles rather than a
       * modal on top of a map.
       */
      map.on("contextmenu", (e: import("leaflet").LeafletMouseEvent) => {
        setPending({ lat: e.latlng.lat, lon: e.latlng.lng });
      });
      /**
       * The basemap.
       *
       * This was CARTO's dark_all, which was keyless when it was written and is
       * not any more — it now stamps "API KEY REQUIRED" across every tile. So:
       * OpenStreetMap's standard raster, which is keyless, serves to z19, and is
       * already the tile source that OSRM and Nominatim are drawn against.
       *
       * OSM standard is light and this interface is near-black; the tiles are
       * inverted to dark in CSS (`.atlas-map .leaflet-tile-pane`) rather than by
       * paying another provider for a dark style.
       *
       * minZoom stays at 2 deliberately: the zoomend handler above uses
       * "zoom <= 2" to hand back to the globe, so lowering it would change
       * navigation rather than just widen the range.
       */
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: MAX_ZOOM }).addTo(map);

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
      } catch (err) {
        if (!disposed) setStatus(`MAP FAILED — ${(err as Error)?.message ?? "unknown"}`.slice(0, 80));
      }
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
          for (const s of asArray<{ name: string; lat: number; lon: number; alt: number }>(j?.data)) all.push(s);
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
      if (j?.data?.url) { layer = L.tileLayer(j.data.url, { opacity: 0.6, maxZoom: MAX_ZOOM, maxNativeZoom: 10, pane: "overlayPane" }); layer.addTo(g); }
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
      { opacity: 0.7, maxZoom: MAX_ZOOM, pane: "overlayPane" },
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
        for (const q of asArray<{ lat: number; lon: number; mag: number; place: string; time: string }>(j?.data)) {
          L.circleMarker([q.lat, q.lon], { radius: 2 + q.mag * 1.6, color: "#ff3b30", weight: 1, fillColor: "#ff3b30", fillOpacity: 0.15 })
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
    const load = () => fetch("/api/atlas/conflicts").then((r) => r.json()).then((j) => setConflictNews(asArray(j?.data))).catch(() => {});
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
      color: "#ff3b30", weight: 1, fillColor: "#ff3b30", fillOpacity: 0.07,
    }).addTo(g);
    L.circleMarker([position.lat, position.lon], {
      radius: 4, color: "#0c0d0f", weight: 2, fillColor: "#ff3b30", fillOpacity: 1,
    }).bindTooltip(`YOU · ±${Math.round(position.accuracy)}m`, { direction: "top" }).addTo(g);
    g.addTo(map);
    meRef.current = g;

    // "Zoom in to my location and ping it" — on the first fix only.
    if (!centredRef.current) {
      centredRef.current = true;
      map.setView([position.lat, position.lon], 16, { animate: true });
    }
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
        icon: L.divIcon({
          className: `atlas-place${pinned?.id === p.id ? " on" : ""}`,
          html: `<i></i><span>${p.name}</span>`, iconSize: [0, 0],
        }),
        // The label is the click target, so it needs to accept clicks even
        // though the marker class as a whole does not.
        interactive: true,
      })
        .on("click", () => setPinned((cur) => (cur?.id === p.id ? null : p)))
        .bindTooltip(`ROUTE TO ${p.name.toUpperCase()}`, { direction: "top" })
        .addTo(g);
    }
    g.addTo(map);
    placeRef.current = g;
  }, [ready, places, pinned]);

  /**
   * The route to wherever he is due to be.
   *
   * Drawn only when a place's window is open AND he is not already there —
   * directions to the gym while standing in the gym are noise.
   */
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map || !position) { setRoute(null); return; }

    // An explicit ask wins over the schedule. Asking for directions and being
    // given directions somewhere else is the worst possible answer.
    const target = pinned ?? dueAt(places, new Date(), position);
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
        const line = L.polyline(j.data.points, { color: "#ff3b30", weight: 3, opacity: 0.85 });
        line.addTo(map);
        routeRef.current = line;
        setRoute({ meters: j.data.meters, seconds: j.data.seconds, name: target.name });
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // Recomputed when he moves far enough to matter, not on every GPS tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, places, pinned, Math.round((position?.lat ?? 0) * 500), Math.round((position?.lon ?? 0) * 500)]);

  /** Save the right-clicked spot. */
  const savePending = async () => {
    if (!pending || !placeName.trim()) return;
    const body = { name: placeName.trim(), lat: pending.lat, lon: pending.lon };
    setPending(null);
    setPlaceName("");
    const j = await fetch("/api/places", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => null);
    if (j?.ok) {
      // The marker effect listens on this scope, so the pin lands now rather
      // than on the five-minute poll.
      setPlaces((prev) => [...prev, j.data]);
      notifyDataChanged("places");
    }
  };

  /** Centre on him — the control every map has and this one did not. */
  const centreOnMe = () => {
    if (!position || !mapRef.current) return;
    mapRef.current.setView([position.lat, position.lon], Math.max(mapRef.current.getZoom(), 16), { animate: true });
  };

  // Re-center when the caller hands a new focus point (globe → map).
  useEffect(() => {
    // Once he has been located, his position wins over the handoff point —
    // otherwise the globe's centre drags the map back off him.
    if (!ready || !center || !mapRef.current || centredRef.current) return;
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
          {/* Leaflet's own attribution control is off, and the OSM tile policy
              requires credit — so it lives in the chrome instead. */}
          <a className="atlas-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OSM</a>
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

        {/* Find a place. Right-click adds where you already are; this is the
            other half — getting somewhere you have not found yet. */}
        {!pending && (
          <div className="rail atlas-find">
            <span className="k">FIND</span>
            <input
              className="atlas-name"
              value={query}
              placeholder="SEARCH A PLACE, ADDRESS OR LANDMARK"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); setHits([]); } }}
            />
            {seeking && <span className="k">…</span>}
            {query && <button className="atlas-chip" onClick={() => { setQuery(""); setHits([]); }}>CLEAR</button>}
            {!query && <span className="atlas-hint">OR RIGHT-CLICK THE MAP TO SAVE A SPOT</span>}
          </div>
        )}

        {hits.length > 0 && (
          <div className="atlas-hits">
            {hits.map((h, i) => (
              <button
                key={i}
                className="atlas-hit"
                onClick={() => {
                  mapRef.current?.setView([h.lat, h.lon], 16, { animate: true });
                  // Offer it for saving, rather than saving it silently — a
                  // search result is a look, not a commitment.
                  setPending({ lat: h.lat, lon: h.lon });
                  setPlaceName(h.name.split(",")[0] ?? "");
                  setQuery(""); setHits([]);
                }}
              >
                <span className="ah-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="ah-t">{h.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="atlas-layers">
          {layers.map((l) => (
            <button key={l.key} className={`atlas-chip${l.on ? " on" : ""}`} onClick={() => toggle(l.key)}>
              <span className="ac-ic">{l.icon}</span>{l.label}{l.live && <span className="ac-live" />}
            </button>
          ))}
        </div>

        {/* Naming a spot happens in the toolbar, not in a modal over the map —
            he needs to see where he clicked while he names it. */}
        {pending && (
          <div className="rail">
            <span className="sig">NEW PLACE</span>
            <span className="v">{pending.lat.toFixed(4)}, {pending.lon.toFixed(4)}</span>
            <input
              className="atlas-name"
              autoFocus
              value={placeName}
              placeholder="NAME IT — GYM, HOME, OFFICE"
              onChange={(e) => setPlaceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void savePending();
                if (e.key === "Escape") { setPending(null); setPlaceName(""); }
              }}
            />
            <button className="atlas-chip on" onClick={() => void savePending()} disabled={!placeName.trim()}>SAVE</button>
            <button className="atlas-chip" onClick={() => { setPending(null); setPlaceName(""); }}>CANCEL</button>
          </div>
        )}

        {route && (
          <div className="rail">
            <span className="sig">ROUTE</span>
            <span className="v">{route.name.toUpperCase()}</span>
            <span className="sep" />
            <span className="v">{(route.meters / 1000).toFixed(1)} KM</span>
            <span className="v">{Math.round(route.seconds / 60)} MIN</span>
            {/* Say which kind of route this is. A schedule-driven one appears
                on its own and should not look like something he asked for. */}
            <span className="k">{pinned ? "REQUESTED" : "SCHEDULED"}</span>
            {pinned && <button className="atlas-chip" onClick={() => setPinned(null)}>CLEAR</button>}
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
