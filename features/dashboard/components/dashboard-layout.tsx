"use client";

import { useEffect, useState } from "react";
import { Reorder } from "framer-motion";
import { GripVertical, LayoutGrid, Check } from "lucide-react";
import { sound } from "@/lib/sound";

interface Band { id: string; label: string; node: React.ReactNode }
const LS_KEY = "sage-band-order";

/** Renders the dashboard bands in the user's saved order; an Edit Layout
 *  mode lets them drag-reorder every band. Order persists on the device. */
export function DashboardLayout({ bands }: { bands: Band[] }) {
  const [order, setOrder] = useState<string[]>(bands.map((b) => b.id));
  const [edit, setEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as string[] | null;
      if (saved) {
        // keep saved order, append any new bands, drop removed ones
        const known = new Set(bands.map((b) => b.id));
        const merged = [...saved.filter((id) => known.has(id)), ...bands.map((b) => b.id).filter((id) => !saved.includes(id))];
        setOrder(merged);
      }
    } catch {}
    setLoaded(true);
  }, [bands]);

  const byId = new Map(bands.map((b) => [b.id, b]));
  const commit = (next: string[]) => {
    setOrder(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  };
  const reset = () => { try { localStorage.removeItem(LS_KEY); } catch {}; setOrder(bands.map((b) => b.id)); };

  if (!loaded) return <div>{bands.map((b) => <div key={b.id}>{b.node}</div>)}</div>;

  return (
    <div>
      {!edit ? (
        order.map((id) => <div key={id}>{byId.get(id)?.node}</div>)
      ) : (
        <Reorder.Group axis="y" values={order} onReorder={commit} as="div">
          {order.map((id) => (
            <Reorder.Item key={id} value={id} as="div" className="band-edit">
              <div className="band-handle"><GripVertical className="size-4" /><span>{byId.get(id)?.label}</span></div>
              <div className="band-preview">{byId.get(id)?.node}</div>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      )}

      <button
        className="layout-toggle"
        onClick={() => { setEdit((e) => !e); sound.tick(); }}
      >
        {edit ? <><Check className="size-3.5" /> DONE</> : <><LayoutGrid className="size-3.5" /> EDIT LAYOUT</>}
      </button>
      {edit && <button className="layout-reset" onClick={reset}>RESET ORDER</button>}
    </div>
  );
}
