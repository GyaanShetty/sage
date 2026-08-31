"use client";

import { useState } from "react";
import { MapPin, Trash2 } from "lucide-react";
import { sound } from "@/lib/sound";
import { useLive, notifyDataChanged } from "@/lib/live";
import type { Place } from "@/core/places/schedule";
import { asArray } from "@/lib/as-array";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** "18:30" → 1110. The panel speaks clock; the record stores minutes. */
const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};
const toClock = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * The places SAGE knows, and when he is meant to be at them.
 *
 * Creating one happens on the map — right-click where you mean, which is the
 * only way to place a point accurately. This is where it gets its schedule,
 * because a schedule needs two time fields and seven day toggles, and that is
 * more than belongs in a popup over a map.
 *
 * The schedule is the part that earns its keep: a place with one lets SAGE
 * notice "it is gym time and you are not at the gym" and draw the route.
 * Without it, this is a bookmark list.
 */
export function PlacesPanel() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [from, setFrom] = useState("18:00");
  const [to, setTo] = useState("20:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);

  const load = () =>
    fetch("/api/places").then((r) => r.json()).then((j) => setPlaces(asArray(j?.data))).catch(() => setPlaces([]));
  useLive(load, { everyMs: 300_000, scopes: ["places"] });

  const beginEdit = (p: Place) => {
    setEditId(p.id);
    setFrom(toClock(p.schedule?.fromMin ?? 18 * 60));
    setTo(toClock(p.schedule?.toMin ?? 20 * 60));
    setDays(p.schedule?.days ?? [1, 2, 3, 4, 5]);
  };

  const saveSchedule = async (p: Place) => {
    const schedule = { fromMin: toMin(from), toMin: toMin(to), days };
    setEditId(null);
    // Optimistic: the row updates now, and the write follows.
    setPlaces((prev) => (prev ? prev.map((x) => (x.id === p.id ? { ...x, schedule } : x)) : prev));
    sound.blip();
    // PATCH, not re-save: recreating would mint a new id and orphan anything
    // holding the old one — a drawn route, a pending announcement.
    await fetch("/api/places", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: p.id, schedule }),
    }).catch(() => {});
    notifyDataChanged("places");
  };

  const remove = async (p: Place) => {
    setPlaces((prev) => (prev ? prev.filter((x) => x.id !== p.id) : prev));
    await fetch(`/api/places?id=${p.id}`, { method: "DELETE" }).catch(() => {});
    notifyDataChanged("places");
  };

  return (
    <div className="cell">
      <div className="bh">
        <span className="t" style={{ fontSize: 10 }}>Places</span>
        <span className="i">GEO</span>
        <span className="r">{places ? String(places.length).padStart(2, "0") : "··"}</span>
      </div>

      {places === null && <p className="lbl">LOADING…</p>}

      {places?.length === 0 && (
        <p className="pp-dim">
          None yet. Right-click anywhere on the Atlas map to save a spot — your gym, home, the office.
        </p>
      )}

      <div className="tm-list">
        {(places ?? []).map((p) => (
          <div className="tm-row" key={p.id}>
            <MapPin className="size-3 shrink-0" style={{ color: "var(--signal)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tm-title">{p.name}</div>
              {editId === p.id ? (
                <div className="pl-edit">
                  <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
                  <span>→</span>
                  <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
                  <div className="pl-days">
                    {DAYS.map((d, i) => (
                      <button
                        key={i}
                        className={days.includes(i) ? "on" : ""}
                        title={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}
                        onClick={() => setDays((ds) => (ds.includes(i) ? ds.filter((x) => x !== i) : [...ds, i].sort()))}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <button className="atlas-chip on" onClick={() => void saveSchedule(p)}>SAVE</button>
                  <button className="atlas-chip" onClick={() => setEditId(null)}>CANCEL</button>
                </div>
              ) : (
                <button className="pl-when" onClick={() => beginEdit(p)}>
                  {p.schedule
                    ? `${toClock(p.schedule.fromMin)}–${toClock(p.schedule.toMin)} · ${
                        p.schedule.days.length === 7 || p.schedule.days.length === 0
                          ? "EVERY DAY"
                          : p.schedule.days.map((d) => DAYS[d]).join("")
                      }`
                    : "SET A SCHEDULE →"}
                </button>
              )}
            </div>
            <button className="tm-ic danger" onClick={() => void remove(p)} aria-label={`Forget ${p.name}`}>
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
