"use client";

import { useEffect, useRef, useState } from "react";
import { HeroGlobe } from "./hero-globe";
import { AtlasMap } from "./atlas-map";

/**
 * The centerpiece: a 3D intelligence globe that scales down into a flat
 * Google-Maps-style view. Dive in (scroll) or hit the toggle to cross-fade
 * from GLOBE to MAP; zoom the map all the way out to rise back to the globe.
 */
export function WorldView({ lat = 18, lon = 78 }: { lat?: number; lon?: number }) {
  const [mode, setMode] = useState<"globe" | "map">("globe");
  const [mapMounted, setMapMounted] = useState(false);
  const centerRef = useRef<[number, number]>([lat, lon]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([lat, lon]);

  const toMap = (c?: { lat: number; lng: number }) => {
    if (c) centerRef.current = [c.lat, c.lng];
    setMapCenter([...centerRef.current] as [number, number]);
    setMapMounted(true);
    setMode("map");
  };
  const toGlobe = () => setMode("globe");

  // Leaflet needs a size recalculation when it becomes visible.
  const mapWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== "map") return;
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 460);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className="worldview">
      <div className={`wv-layer${mode === "globe" ? " on" : ""}`}>
        <HeroGlobe onZoomIn={toMap} onCenter={(c) => { centerRef.current = [c.lat, c.lng]; }} />
      </div>
      {mapMounted && (
        <div className={`wv-layer${mode === "map" ? " on" : ""}`} ref={mapWrapRef}>
          <AtlasMap lat={mapCenter[0]} lon={mapCenter[1]} center={mapCenter} onZoomOut={toGlobe} />
        </div>
      )}
      <button className="wv-toggle" onClick={() => (mode === "globe" ? toMap() : toGlobe())}>
        {mode === "globe" ? "MAP VIEW ⤢" : "◍ GLOBE VIEW"}
      </button>
    </div>
  );
}
