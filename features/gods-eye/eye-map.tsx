"use client";

/**
 * The globe, flattened.
 *
 * Leaflet rather than a 3D engine. God's Eye View uses Cesium and a
 * photorealistic terrain stack, which is the right call for a project whose
 * subject is the planet; here the map is one page of a personal terminal, and
 * a WebGL globe with its own tile budget and its own camera model is a large
 * thing to carry for one screen. The layers are what matter, and they are the
 * same layers.
 *
 * Every marker is drawn as a divIcon rather than an image, so the whole thing
 * stays monochrome with the rest of the application and costs no requests.
 */

import { useEffect, useRef, useState } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";
import { shareJson } from "@/lib/share";
import { asArray } from "@/lib/as-array";
import "leaflet/dist/leaflet.css";

interface Quake { id: string; mag: number; place: string; lat: number; lon: number; depth: number; at: number; tsunami: boolean }
interface Storm { id: string; name: string; classification: string; lat: number; lon: number; intensityKt: number | null }
interface Sat { name: string; lat: number; lon: number; alt: number }
interface Plane { lat: number; lon: number; callsign: string; alt: number }

const SAT_GROUPS = ["stations", "visual"] as const;

export function EyeMap({
  quakes, storms, showAircraft, showSats, focus,
}: {
  quakes: Quake[]; storms: Storm[];
  showAircraft: boolean; showSats: boolean;
  focus: { lat: number; lon: number; zoom?: number } | null;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const groups = useRef<Record<string, LayerGroup>>({});
  /*
   * Leaflet loads asynchronously, and every layer effect below needs it. Each
   * one returned early when the map was not up yet — and since its only other
   * dependency is the data, which had already arrived, nothing ever re-ran
   * them. Markers appeared only when the data happened to land *after* the
   * map, which is a race you win about half the time; measured, the desktop
   * drew none and the phone drew forty-six.
   *
   * A state flag rather than a ref, because the point is to re-render and
   * re-run the effects once it flips.
   */
  const [ready, setReady] = useState(false);

  /* ── the map, once ──────────────────────────────────────────────────── */
  useEffect(() => {
    let dead = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (dead || !elRef.current || mapRef.current) return;
      LRef.current = L;

      const map = L.map(elRef.current, {
        zoomControl: false,
        attributionControl: false,
        worldCopyJump: true,
        minZoom: 2,
        // A wheel over a full-page map must not fight the page for the
        // gesture; click to engage, leave to disengage.
        scrollWheelZoom: "center",
      }).setView([20, 10], 3);
      map.scrollWheelZoom.disable();
      map.on("click", () => map.scrollWheelZoom.enable());
      map.on("mouseout", () => map.scrollWheelZoom.disable());

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 12 }).addTo(map);
      for (const k of ["quakes", "storms", "sats", "planes"]) groups.current[k] = L.layerGroup().addTo(map);

      mapRef.current = map;
      setReady(true);

      // Leaflet caches the container size at construction; without this the
      // map draws into a box of the wrong height until something resizes.
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(elRef.current);
      return () => ro.disconnect();
    })();

    return () => {
      dead = true;
      // Clear the ref BEFORE removing, or a late callback operates on a map
      // that is already gone and throws on _leaflet_pos.
      const m = mapRef.current;
      mapRef.current = null;
      try { m?.remove(); } catch { /* already gone */ }
    };
  }, []);

  /* ── seismic ────────────────────────────────────────────────────────── */
  useEffect(() => {
    const L = LRef.current, g = groups.current.quakes;
    if (!ready || !L || !g) return;
    g.clearLayers();
    for (const q of quakes) {
      // Radius by magnitude, not colour: magnitude is a quantity and area is
      // how a quantity is read on a map.
      const r = Math.max(3, (q.mag - 2) * 3.4);
      L.circleMarker([q.lat, q.lon], {
        radius: r,
        className: `ge-quake${q.mag >= 5 ? " big" : ""}`,
        weight: 1, fillOpacity: 0.18,
      })
        .bindTooltip(`M${q.mag.toFixed(1)} · ${q.place} · ${Math.round(q.depth)}km`, { sticky: true })
        .addTo(g);
    }
  }, [quakes, ready]);

  /* ── cyclones ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const L = LRef.current, g = groups.current.storms;
    if (!ready || !L || !g) return;
    g.clearLayers();
    for (const s of storms) {
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: "ge-storm", html: "◉", iconSize: [22, 22] }),
      })
        .bindTooltip(`${s.name} · ${s.classification}${s.intensityKt ? ` · ${s.intensityKt}kt` : ""}`, { sticky: true })
        .addTo(g);
    }
  }, [storms, ready]);

  /* ── satellites ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const L = LRef.current, g = groups.current.sats;
    if (!ready || !L || !g) return;
    if (!showSats) { g.clearLayers(); return; }
    let stop = false;

    const draw = async () => {
      const settled = await Promise.allSettled(
        SAT_GROUPS.map((grp) => shareJson<{ data?: unknown }>(`/api/atlas/satellites?group=${grp}`, 60_000)),
      );
      if (stop) return;
      g.clearLayers();
      for (const r of settled) {
        if (r.status !== "fulfilled") continue;
        for (const s of asArray<Sat>(r.value?.data)) {
          const iss = /ISS|ZARYA/i.test(s.name);
          L.marker([s.lat, s.lon], {
            icon: L.divIcon({ className: `ge-sat${iss ? " iss" : ""}`, html: iss ? "◆" : "•", iconSize: [10, 10] }),
          }).bindTooltip(`${s.name} · ${Math.round(s.alt)}km`, { sticky: true }).addTo(g);
        }
      }
    };
    void draw();
    const id = setInterval(draw, 30_000);
    return () => { stop = true; clearInterval(id); };
  }, [showSats, ready]);

  /* ── aircraft ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const L = LRef.current, g = groups.current.planes;
    if (!ready || !L || !g) return;
    if (!showAircraft) { g.clearLayers(); return; }
    let stop = false;

    const draw = async () => {
      const j = await shareJson<{ data?: { planes?: unknown } }>("/api/sky", 60_000).catch(() => null);
      if (stop || !j) return;
      g.clearLayers();
      for (const p of asArray<Plane>(j.data?.planes)) {
        L.marker([p.lat, p.lon], {
          icon: L.divIcon({ className: "ge-plane", html: "✈", iconSize: [12, 12] }),
        }).bindTooltip(`${p.callsign || "——"} · ${Math.round(p.alt)}m`, { sticky: true }).addTo(g);
      }
    };
    void draw();
    const id = setInterval(draw, 60_000);
    return () => { stop = true; clearInterval(id); };
  }, [showAircraft, ready]);

  /* ── fly to a row ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo([focus.lat, focus.lon], focus.zoom ?? 5, { duration: 0.8 });
  }, [focus]);

  return <div ref={elRef} className="ge-map" />;
}
