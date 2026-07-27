"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Briefcase, Plus, RefreshCw, Trash2, ChevronLeft, ChevronRight, Sparkles, Loader2, Calendar, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "@/features/dashboard/command.css";

const STAGES = ["applied", "assessment", "interview", "offer", "rejected"] as const;
type Stage = (typeof STAGES)[number];
const STAGE_META: Record<Stage, { label: string; color: string }> = {
  applied: { label: "Applied", color: "#7b8cff" },
  assessment: { label: "Assessment / OA", color: "#e8a13a" },
  interview: { label: "Interview", color: "#5ecfd6" },
  offer: { label: "Offer", color: "#54c98a" },
  rejected: { label: "Closed", color: "#8a8a90" },
};

interface App { id: string; company: string; role: string; stage: Stage; deadline?: string | null; notes?: string | null; source: string }
interface Prep { overview: string; recentNews: string[]; likelyQuestions: string[]; yourFit: string; tips: string[] }

export function CareerView() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [nc, setNc] = useState({ company: "", role: "" });
  const [prepFor, setPrepFor] = useState<App | null>(null);
  const [prep, setPrep] = useState<Prep | null>(null);
  const [prepLoading, setPrepLoading] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch("/api/career").then((r) => r.json()).catch(() => null);
    setApps(j?.data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    setScanning(true);
    const j = await fetch("/api/career", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "scan" }) }).then((r) => r.json()).catch(() => null);
    setScanning(false);
    if (j?.data) setToast(`Scan complete — ${j.data.added} added, ${j.data.updated} updated`);
    setTimeout(() => setToast(null), 4000);
    load();
  };

  const move = async (a: App, dir: number) => {
    const i = STAGES.indexOf(a.stage);
    const stage = STAGES[Math.max(0, Math.min(STAGES.length - 1, i + dir))];
    setApps((p) => p?.map((x) => (x.id === a.id ? { ...x, stage } : x)) ?? p);
    await fetch("/api/career", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: a.id, stage }) });
  };

  const remove = async (id: string) => {
    setApps((p) => p?.filter((x) => x.id !== id) ?? p);
    await fetch(`/api/career?id=${id}`, { method: "DELETE" });
  };

  const add = async () => {
    if (!nc.company.trim()) return;
    setAdding(false);
    await fetch("/api/career", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company: nc.company.trim(), role: nc.role.trim() || "—", stage: "applied", source: "manual" }) });
    setNc({ company: "", role: "" });
    load();
  };

  const openPrep = async (a: App) => {
    setPrepFor(a); setPrep(null); setPrepLoading(true);
    const j = await fetch("/api/career/prep", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company: a.company, role: a.role }) }).then((r) => r.json()).catch(() => null);
    setPrep(j?.data ?? null); setPrepLoading(false);
  };

  const counts = STAGES.map((s) => apps?.filter((a) => a.stage === s).length ?? 0);
  const active = (apps ?? []).filter((a) => a.stage !== "rejected").length;

  return (
    <div className="cc-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}>
          <span className="sn">CC</span><h2>Career</h2><span className="line" />
          <span className="tag">{active} ACTIVE · {apps?.filter((a) => a.stage === "offer").length ?? 0} OFFERS</span>
        </div>
        <div className="cc-actions">
          <button onClick={() => setAdding((s) => !s)} className="cc-btn"><Plus className="size-3.5" /> Add</button>
          <button onClick={scan} disabled={scanning} className="cc-btn cc-scan">
            {scanning ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Scan inbox
          </button>
        </div>
      </div>

      <AnimatePresence>
        {toast && <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="cc-toast">{toast}</motion.div>}
        {adding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="cc-addform">
              <input value={nc.company} onChange={(e) => setNc({ ...nc, company: e.target.value })} placeholder="Company" />
              <input value={nc.role} onChange={(e) => setNc({ ...nc, role: e.target.value })} placeholder="Role / programme" onKeyDown={(e) => e.key === "Enter" && add()} />
              <button onClick={add} className="cc-btn cc-scan">Add</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="cc-board">
        {STAGES.map((s, si) => (
          <div key={s} className="cc-col">
            <div className="cc-colhead" style={{ ["--c" as string]: STAGE_META[s].color }}>
              <span className="cc-dot" style={{ background: STAGE_META[s].color }} />
              {STAGE_META[s].label}<span className="cc-count">{counts[si]}</span>
            </div>
            <div className="cc-cards">
              {apps === null && <p className="lbl" style={{ padding: "8px 0" }}>LOADING…</p>}
              {apps?.filter((a) => a.stage === s).map((a) => (
                <div key={a.id} className="cc-card">
                  <div className="cc-company">{a.company}</div>
                  <div className="cc-role">{a.role}</div>
                  {a.deadline && <div className="cc-deadline"><Calendar className="size-3" /> {new Date(a.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>}
                  <div className="cc-cardbtns">
                    <button onClick={() => move(a, -1)} disabled={si === 0} title="Back"><ChevronLeft className="size-3.5" /></button>
                    <button onClick={() => move(a, 1)} disabled={si === STAGES.length - 1} title="Advance"><ChevronRight className="size-3.5" /></button>
                    {(s === "interview" || s === "assessment") && <button onClick={() => openPrep(a)} title="Prep me" className="cc-prep"><Sparkles className="size-3.5" /></button>}
                    <button onClick={() => remove(a.id)} title="Remove" className="cc-del"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
              ))}
              {apps && counts[si] === 0 && <p className="cc-empty">—</p>}
            </div>
          </div>
        ))}
      </div>

      {apps && apps.length === 0 && (
        <div className="cc-zero"><Briefcase className="size-6 opacity-40" /><p>No applications yet. Hit <b>Scan inbox</b> and SAGE will build your pipeline from Gmail.</p></div>
      )}

      {/* prep drawer */}
      <AnimatePresence>
        {prepFor && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="cc-prepwrap" onClick={() => setPrepFor(null)}>
            <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} className="cc-prepdrawer" onClick={(e) => e.stopPropagation()}>
              <div className="cc-prephead">
                <div><span className="lbl !text-[9px]">INTERVIEW PREP</span><h3>{prepFor.company}</h3><span className="cc-role">{prepFor.role}</span></div>
                <button onClick={() => setPrepFor(null)}><X className="size-4" /></button>
              </div>
              {prepLoading && <div className="mb-load"><Loader2 className="size-5 animate-spin" /> <span style={{ marginLeft: 10, fontSize: 12 }}>Researching {prepFor.company}…</span></div>}
              {prep && (
                <div className="cc-prepbody">
                  <p className="cc-prepsum">{prep.overview}</p>
                  <Section title="RECENT NEWS" items={prep.recentNews} />
                  <div className="cc-prepsec"><span className="lbl !text-[9px]">YOUR FIT</span><p>{prep.yourFit}</p></div>
                  <Section title="LIKELY QUESTIONS" items={prep.likelyQuestions} ordered />
                  <Section title="PREP TIPS" items={prep.tips} />
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Section({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items?.length) return null;
  return (
    <div className="cc-prepsec">
      <span className="lbl !text-[9px]">{title}</span>
      <ul className={cn("cc-preplist", ordered && "ord")}>{items.map((t, i) => <li key={i}>{ordered && <b>{i + 1}.</b>} {t}</li>)}</ul>
    </div>
  );
}
