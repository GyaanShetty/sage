"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

interface RouteInfo {
  km: number;
  mins: number;
}

/**
 * Live map (Leaflet + free CARTO dark tiles — no API key, no card).
 * Tap anywhere to get a driving route + ETA from home via the public OSRM server.
 */
export function GeoMap({ lat: LAT = 12.9716, lon: LON = 77.5946 }: { lat?: number; lon?: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [routing, setRouting] = useState(false);
  const [located, setLocated] = useState(false);
  const originRef = useRef<{ lat: number; lon: number }>({ lat: LAT, lon: LON });

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | null = null;

    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !elRef.current) return;

      map = L.map(elRef.current, { zoomControl: false, attributionControl: false }).setView([LAT, LON], 12);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map);

      const homeIcon = L.divIcon({ className: "geo-home", iconSize: [12, 12] });
      const homeMarker = L.marker([LAT, LON], { icon: homeIcon }).addTo(map);
      const homeRing = L.circle([LAT, LON], { radius: 400, color: "#5ecfd6", weight: 1, opacity: 0.4, fillOpacity: 0.06 }).addTo(map);

      // Use the device's real position when the user allows it — the env
      // coords are only a fallback so the map never opens on a blank spot.
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          if (disposed || !map) return;
          const { latitude, longitude } = pos.coords;
          originRef.current = { lat: latitude, lon: longitude };
          homeMarker.setLatLng([latitude, longitude]);
          homeRing.setLatLng([latitude, longitude]);
          map.setView([latitude, longitude], 14);
          setLocated(true);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000 },
      );

      let routeLine: import("leaflet").Polyline | null = null;
      let destMarker: import("leaflet").Marker | null = null;

      map.on("click", async (e: import("leaflet").LeafletMouseEvent) => {
        if (!map) return;
        setRouting(true);
        setRoute(null);
        routeLine?.remove();
        destMarker?.remove();
        destMarker = L.marker(e.latlng, { icon: L.divIcon({ className: "geo-dest", iconSize: [10, 10] }) }).addTo(map);
        try {
          const origin = originRef.current;
          const res = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${e.latlng.lng},${e.latlng.lat}?overview=full&geometries=geojson`,
          );
          const json = await res.json();
          const r = json?.routes?.[0];
          if (r) {
            const coords = (r.geometry.coordinates as [number, number][]).map(
              ([lng, lat]) => [lat, lng] as [number, number],
            );
            routeLine = L.polyline(coords, { color: "#5ecfd6", weight: 2, opacity: 0.85 }).addTo(map);
            setRoute({ km: r.distance / 1000, mins: r.duration / 60 });
          }
        } catch {
          // routing server busy — leave the pin, no ETA
        } finally {
          setRouting(false);
        }
      });
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, []);

  return (
    <div className="cell" style={{ padding: 0, position: "relative" }}>
      <div className="bh" style={{ position: "absolute", zIndex: 500, left: 14, top: 12, marginBottom: 0 }}>
        <span className="t" style={{ fontSize: 10 }}>Ground Ops</span>
        <span className="i">GEO</span>
      </div>
      <div className="geo-readout">
        {routing
          ? "ROUTING…"
          : route
            ? `${route.km.toFixed(1)} KM · ${Math.round(route.mins)} MIN DRIVE`
            : located
              ? "LOCKED ON YOU · TAP MAP FOR ROUTE + ETA"
              : "TAP MAP FOR ROUTE + ETA"}
      </div>
      <div ref={elRef} className="geo-map" />
    </div>
  );
}
