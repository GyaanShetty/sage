"use client";

import { useEffect, useRef, useState } from "react";
import { HeroGlobe } from "./hero-globe";
import { AtlasMap } from "./atlas-map";
import { useGlobeEnabled } from "@/lib/globe-pref";

/**
 * The centrepiece: a 3D intelligence globe that scales down into a flat
 * Google-Maps-style view. Dive in (scroll) or hit the toggle to cross-fade
 * from GLOBE to MAP; zoom the map all the way out to rise back to the globe.
 *
 * Two things about cost, because the globe is by far the most expensive thing
 * on the page:
 *
 * 1. It can be turned off entirely, and then it is never mounted — not hidden,
 *    not paused, absent. The map becomes the view. The preference is per
 *    device, since the right answer on a desktop is often wrong on a phone.
 * 2. Even when it is on, switching to the map now UNMOUNTS it once the
 *    cross-fade has finished. Previously the map layer simply covered it while
 *    the WebGL loop kept running and satellites kept polling every five
 *    seconds — so "switching to map" bought nothing at all.
 */

/** Long enough for the cross-fade to finish before the globe is torn down. */
const FADE_MS = 520;

export function WorldView({ lat = 18, lon = 78 }: { lat?: number; lon?: number }) {
  const { on: globeOn, ready, set: setGlobeOn } = useGlobeEnabled();

  const [mode, setMode] = useState<"globe" | "map">("globe");
  const [mapMounted, setMapMounted] = useState(false);
  const [globeMounted, setGlobeMounted] = useState(false);
  const centerRef = useRef<[number, number]>([lat, lon]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([lat, lon]);

  const toMap = (c?: { lat: number; lng: number }) => {
    if (c) centerRef.current = [c.lat, c.lng];
    setMapCenter([...centerRef.current] as [number, number]);
    setMapMounted(true);
    setMode("map");
  };
  const toGlobe = () => setMode("globe");

  // With the globe off there is nothing to fade to or from: the map is the
  // whole view, and it must be mounted immediately rather than on first toggle.
  useEffect(() => {
    if (ready && !globeOn) { setMapMounted(true); setMode("map"); }
  }, [ready, globeOn]);

  // Mount the globe only while it is actually wanted on screen, and give the
  // fade time to complete before pulling it out from under itself.
  useEffect(() => {
    if (!ready || !globeOn) { setGlobeMounted(false); return; }
    if (mode === "globe") { setGlobeMounted(true); return; }
    const t = setTimeout(() => setGlobeMounted(false), FADE_MS);
    return () => clearTimeout(t);
  }, [ready, globeOn, mode]);

  // Leaflet needs a size recalculation when it becomes visible.
  const mapWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== "map") return;
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 460);
    return () => clearTimeout(t);
  }, [mode]);

  const showGlobeLayer = globeOn && mode === "globe";

  return (
    <div className="worldview">
      {/* View controls lead, above the map rather than floating on top of it.
          They used to be absolutely positioned over the tiles — covering the
          thing they control, and forcing the map to stay tall enough to have
          room to spare. */}
      <div className="wv-controls">
        {globeOn && (
          <button className="wv-toggle" onClick={() => (mode === "globe" ? toMap() : toGlobe())}>
            {mode === "globe" ? "MAP VIEW ⤢" : "◍ GLOBE VIEW"}
          </button>
        )}
        <button
          className="wv-toggle wv-power"
          title={globeOn ? "Turn the 3D globe off — the map takes over and the WebGL loop stops" : "Turn the 3D globe back on"}
          onClick={() => { setGlobeOn(!globeOn); if (globeOn) { setMapMounted(true); setMode("map"); } else setMode("globe"); }}
        >
          {globeOn ? "◍ GLOBE ON" : "◍ GLOBE OFF"}
        </button>
      </div>

      <div className="wv-stage">
      {/**
        * Keys matter here.
        *
        * These are two conditional siblings, and the globe is unmounted 520ms
        * after switching to the map. Without keys React reconciles by
        * position, so the map's div shifts from index 1 to index 0 and gets
        * torn down and rebuilt — which lands mid-way through Leaflet's async
        * init, whose `disposed` guard then returns and leaves the map stuck on
        * "BOOTING ATLAS…" with nothing thrown and nothing logged.
        */}
      {globeMounted && (
        <div key="globe" className={`wv-layer${showGlobeLayer ? " on" : ""}`}>
          <HeroGlobe onZoomIn={toMap} onCenter={(c) => { centerRef.current = [c.lat, c.lng]; }} />
        </div>
      )}

      {mapMounted && (
        <div key="map" className={`wv-layer${mode === "map" || !globeOn ? " on" : ""}`} ref={mapWrapRef}>
          <AtlasMap lat={mapCenter[0]} lon={mapCenter[1]} center={mapCenter} onZoomOut={globeOn ? toGlobe : undefined} />
        </div>
      )}

      </div>
    </div>
  );
}
