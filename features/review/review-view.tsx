"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, Loader2, RotateCcw, Sparkles, Check } from "lucide-react";
import "@/features/dashboard/command.css";

interface Card { id: string; front: string; back: string; source: string }

export function ReviewView() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [total, setTotal] = useState(0);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [genning, setGenning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  const load = useCallback(async () => {
    const j = await fetch("/api/review").then((r) => r.json()).catch(() => null);
    setCards(j?.data?.cards ?? []);
    setTotal(j?.data?.total ?? 0);
    setI(0); setFlipped(false); setDoneCount(0);
  }, []);
  useEffect(() => { load(); }, [load]);

  const card = cards?.[i];

  const grade = async (g: number) => {
    if (!card) return;
    await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: card.id, grade: g }) });
    setDoneCount((n) => n + 1);
    setFlipped(false);
    setI((x) => x + 1);
  };

  const generate = async () => {
    setGenning(true);
    await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generate" }) });
    setGenning(false);
    load();
  };

  const finished = cards && i >= cards.length;

  return (
    <div className="rv-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}><span className="sn">RV</span><h2>Review</h2><span className="line" /><span className="tag">{total} CARDS · SPACED REPETITION</span></div>
        <button onClick={generate} disabled={genning} className="cc-btn cc-scan">{genning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Generate from today</button>
      </div>

      {cards === null && <div className="mb-load"><Loader2 className="size-5 animate-spin" /></div>}

      {cards && cards.length === 0 && (
        <div className="cc-zero"><Brain className="size-6 opacity-40" /><p>Nothing due right now. SAGE builds cards from your morning reading and notes each day — or hit <b>Generate from today</b>.</p></div>
      )}

      {card && !finished && (
        <div className="rv-stage">
          <div className="rv-progress">{i + 1} / {cards.length}</div>
          <motion.button key={card.id} className="rv-card" onClick={() => setFlipped((f) => !f)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <span className="rv-src">{card.source.toUpperCase()}</span>
            <AnimatePresence mode="wait">
              {!flipped ? (
                <motion.div key="f" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rv-face">
                  <p className="rv-q">{card.front}</p>
                  <span className="rv-hint">tap to reveal</span>
                </motion.div>
              ) : (
                <motion.div key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rv-face">
                  <p className="rv-a">{card.back}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>

          {flipped && (
            <motion.div className="rv-grades" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <button onClick={() => grade(2)} className="rv-g again"><RotateCcw className="size-3.5" /> Again</button>
              <button onClick={() => grade(4)} className="rv-g good">Good</button>
              <button onClick={() => grade(5)} className="rv-g easy"><Check className="size-3.5" /> Easy</button>
            </motion.div>
          )}
        </div>
      )}

      {finished && cards.length > 0 && (
        <div className="cc-zero"><Check className="size-7" style={{ color: "var(--live)" }} /><p>Done — {doneCount} card{doneCount === 1 ? "" : "s"} reviewed. Sharp as ever, sir.</p><button onClick={load} className="cc-btn">Reload</button></div>
      )}
    </div>
  );
}
