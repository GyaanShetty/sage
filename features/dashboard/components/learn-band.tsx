"use client";

import { useEffect, useState } from "react";

interface Card {
  q: string;
  a: string;
  topic: string;
}

/**
 * 08 LEARN — daily flashcards generated from the user's own knowledge base.
 * Turns ingested PDFs/articles into active recall instead of dead storage.
 */
export function LearnBand() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [known, setKnown] = useState(0);

  useEffect(() => {
    fetch("/api/flashcards")
      .then((r) => r.json())
      .then((j) => setCards(j?.data ?? []))
      .catch(() => setCards([]));
  }, []);

  const card = cards?.[idx];
  const next = (gotIt: boolean) => {
    if (gotIt) setKnown((k) => k + 1);
    setRevealed(false);
    setIdx((i) => i + 1);
  };

  return (
    <section className="section" id="learn" style={{ paddingTop: 0 }}>
      <div className="sectitle"><span className="sn">08</span><h2>Learn</h2><span className="line" /><span className="tag">DAILY RECALL · FROM YOUR KNOWLEDGE</span></div>
      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="cell fcard-cell">
          {cards === null ? (
            <div className="empty-state"><div className="es-t">GENERATING TODAY&apos;S CARDS…</div></div>
          ) : cards.length === 0 ? (
            <div className="empty-state">
              <div className="es-t">NOTHING TO QUIZ YET</div>
              <div className="es-d">Ingest a PDF or article in Knowledge and SAGE will drill you on it daily.</div>
            </div>
          ) : !card ? (
            <div className="empty-state">
              <div className="es-t">SESSION COMPLETE</div>
              <div className="es-d">{known}/{cards.length} recalled. New cards tomorrow.</div>
            </div>
          ) : (
            <div className="fcard" onClick={() => setRevealed(true)}>
              <div className="fc-meta">
                <span className="lbl live !opacity-90">{card.topic.toUpperCase()}</span>
                <span className="lbl">{idx + 1} / {cards.length}</span>
              </div>
              <div className="fc-q">{card.q}</div>
              {revealed ? (
                <>
                  <div className="fc-a">{card.a}</div>
                  <div className="fc-actions">
                    <button className="chip" onClick={(e) => { e.stopPropagation(); next(false); }}>MISSED IT</button>
                    <button className="chip fc-got" onClick={(e) => { e.stopPropagation(); next(true); }}>GOT IT</button>
                  </div>
                </>
              ) : (
                <div className="fc-hint">TAP TO REVEAL</div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
