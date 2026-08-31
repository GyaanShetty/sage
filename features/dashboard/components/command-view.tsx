"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "../command.css";
import "../wall.css";
import { sound } from "@/lib/sound";
import { ExpandModal } from "@/components/expand-modal";
import { TaskManager } from "./task-manager";
import { AtlasMap } from "@/features/atlas/atlas-map";
import { PlayingTile } from "./tiles";
import { TileGuard } from "@/components/tile-guard";
import { AgentLogTile, GithubTile, BioTile, SystemTile } from "./page-tiles";
import {
  MarketsTile, KeyMetricsTile, HealthTile, ActivityTile, MissionTile, FeedsTile,
  ClocksTile, SkyTile, CommandsTile,
} from "./wall-tiles";
import { Pane } from "@/components/pane";
import { Crosshair } from "@/components/chrome";
import { EisenhowerBand } from "./eisenhower-band";
import { SitrepBand } from "./sitrep-band";
import { NextAction } from "./next-action";
import { BriefBlock } from "./brief-block";
import { fmt, TZ } from "@/lib/config";

/* ─── data contracts (all real, server-fetched) ─── */
export interface TaskRow { id: string; title: string; status: string; dueAt: string | null }
export interface EventRow { id?: string; summary: string; start: string; allDay?: boolean }
export interface NoteRow { id: string; title: string; createdAt: string }
export interface LogRow { type: string; createdAt: string }
export interface Stats { memories: number; sources: number; runs: number; notes: number }
export interface WeatherRow { temp: number; high: number; low: number; label: string; wind: number; place: string; aqi?: number | null }

const pad = (n: number) => String(n).padStart(2, "0");

/* ─── Gita rotator (design element from the prototype) ─── */
const GITA = [
  { dev: "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥", tr: "karmaṇy-evādhikāras te mā phaleṣu kadācana", en: "Your right is to the work alone, never to its fruits. Let not the fruits be your motive, nor attachment to inaction.", src: "2.47" },
  { dev: "योगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय ।\nसिद्ध्यसिद्ध्योः समो भूत्वा समत्वं योग उच्यते ॥", tr: "yoga-sthaḥ kuru karmāṇi saṅgaṁ tyaktvā dhanañjaya", en: "Established in yoga, perform action, abandoning attachment — balanced in success and failure. That equanimity is called yoga.", src: "2.48" },
  { dev: "उद्धरेदात्मनात्मानं नात्मानमवसादयेत् ।\nआत्मैव ह्यात्मनो बन्धुरात्मैव रिपुरात्मनः ॥", tr: "uddhared ātmanātmānaṁ nātmānam avasādayet", en: "Lift yourself by your own self; do not let the self sink. The self alone is your friend, and the self alone your enemy.", src: "6.5" },
  { dev: "तस्मादसक्तः सततं कार्यं कर्म समाचर ।\nअसक्तो ह्याचरन्कर्म परमाप्नोति पूरुषः ॥", tr: "tasmād asaktaḥ satataṁ kāryaṁ karma samācara", en: "Therefore, without attachment, always do the work that must be done — for acting without attachment one attains the highest.", src: "3.19" },
  { dev: "मात्रास्पर्शास्तु कौन्तेय शीतोष्णसुखदुःखदाः ।\nआगमापायिनोऽनित्यास्तांस्तितिक्षस्व भारत ॥", tr: "mātrā-sparśās tu kaunteya śītoṣṇa-sukha-duḥkha-dāḥ", en: "Contact with the world brings cold and heat, pleasure and pain. They come and go, impermanent — endure them.", src: "2.14" },
  { dev: "न जायते म्रियते वा कदाचि- न्नायं भूत्वा भविता वा न भूयः ।\nअजो नित्यः शाश्वतोऽयं पुराणो न हन्यते हन्यमाने शरीरे ॥", tr: "na jāyate mriyate vā kadācin", en: "The self is never born, nor does it ever die. Unborn, eternal, everlasting — it is not slain when the body is slain.", src: "2.20" },
  { dev: "सुखदुःखे समे कृत्वा लाभालाभौ जयाजयौ ।\nततो युद्धाय युज्यस्व नैवं पापमवाप्स्यसि ॥", tr: "sukha-duḥkhe same kṛtvā lābhālābhau jayājayau", en: "Treat pleasure and pain, gain and loss, victory and defeat alike — then engage in the fight. Thus you incur no fault.", src: "2.38" },
  { dev: "बुद्धियुक्तो जहातीह उभे सुकृतदुष्कृते ।\nतस्माद्योगाय युज्यस्व योगः कर्मसु कौशलम् ॥", tr: "buddhi-yukto jahātīha ubhe sukṛta-duṣkṛte", en: "One steadied by wisdom leaves behind both good and bad deeds here. Therefore devote yourself to yoga — yoga is skill in action.", src: "2.50" },
  { dev: "ध्यायतो विषयान्पुंसः सङ्गस्तेषूपजायते ।\nसङ्गात्सञ्जायते कामः कामात्क्रोधोऽभिजायते ॥", tr: "dhyāyato viṣayān puṁsaḥ saṅgas teṣūpajāyate", en: "Dwelling on sense objects breeds attachment; attachment breeds craving; craving breeds anger.", src: "2.62" },
  { dev: "क्रोधाद्भवति सम्मोहः सम्मोहात्स्मृतिविभ्रमः ।\nस्मृतिभ्रंशाद्बुद्धिनाशो बुद्धिनाशात्प्रणश्यति ॥", tr: "krodhād bhavati sammohaḥ sammohāt smṛti-vibhramaḥ", en: "From anger comes delusion; from delusion, loss of memory; from loss of memory, the ruin of judgment — and with judgment ruined, one is lost.", src: "2.63" },
  { dev: "आपूर्यमाणमचलप्रतिष्ठं समुद्रमापः प्रविशन्ति यद्वत् ।\nतद्वत्कामा यं प्रविशन्ति सर्वे स शान्तिमाप्नोति न कामकामी ॥", tr: "āpūryamāṇam acala-pratiṣṭhaṁ samudram āpaḥ praviśanti yadvat", en: "As rivers flow into the ocean, which remains full and unmoved, so desires enter the sage who attains peace — not the desirer of desires.", src: "2.70" },
  { dev: "यद्यदाचरति श्रेष्ठस्तत्तदेवेतरो जनः ।\nस यत्प्रमाणं कुरुते लोकस्तदनुवर्तते ॥", tr: "yad yad ācarati śreṣṭhas tat tad evetaro janaḥ", en: "Whatever a great person does, others follow. Whatever standard they set, the world pursues.", src: "3.21" },
  { dev: "श्रेयान्स्वधर्मो विगुणः परधर्मात्स्वनुष्ठितात् ।\nस्वधर्मे निधनं श्रेयः परधर्मो भयावहः ॥", tr: "śreyān sva-dharmo viguṇaḥ para-dharmāt sv-anuṣṭhitāt", en: "Better one's own path, though imperfect, than another's done well. Better to fail at your own duty — another's invites fear.", src: "3.35" },
  { dev: "यदा यदा हि धर्मस्य ग्लानिर्भवति भारत ।\nअभ्युत्थानमधर्मस्य तदात्मानं सृजाम्यहम् ॥", tr: "yadā yadā hi dharmasya glānir bhavati bhārata", en: "Whenever righteousness declines and unrighteousness rises, I bring myself forth.", src: "4.7" },
  { dev: "परित्राणाय साधूनां विनाशाय च दुष्कृताम् ।\nधर्मसंस्थापनार्थाय सम्भवामि युगे युगे ॥", tr: "paritrāṇāya sādhūnāṁ vināśāya ca duṣkṛtām", en: "To protect the good, to destroy the wicked, and to establish righteousness, I appear age after age.", src: "4.8" },
  { dev: "न हि ज्ञानेन सदृशं पवित्रमिह विद्यते ।\nतत्स्वयं योगसंसिद्धः कालेनात्मनि विन्दति ॥", tr: "na hi jñānena sadṛśaṁ pavitram iha vidyate", en: "Nothing in this world purifies like knowledge. One perfected in yoga finds it, in time, within the self.", src: "4.38" },
  { dev: "ब्रह्मण्याधाय कर्माणि सङ्गं त्यक्त्वा करोति यः ।\nलिप्यते न स पापेन पद्मपत्रमिवाम्भसा ॥", tr: "brahmaṇy ādhāya karmāṇi saṅgaṁ tyaktvā karoti yaḥ", en: "One who acts offering all actions to the highest, abandoning attachment, is untouched by fault — as a lotus leaf by water.", src: "5.10" },
  { dev: "बन्धुरात्मात्मनस्तस्य येनात्मैवात्मना जितः ।\nअनात्मनस्तु शत्रुत्वे वर्तेतात्मैव शत्रुवत् ॥", tr: "bandhur ātmātmanas tasya yenātmaivātmanā jitaḥ", en: "For one who has conquered the self, the self is a friend. For one who has not, the self behaves as an enemy.", src: "6.6" },
  { dev: "नात्यश्नतस्तु योगोऽस्ति न चैकान्तमनश्नतः ।\nन चातिस्वप्नशीलस्य जाग्रतो नैव चार्जुन ॥", tr: "nāty-aśnatas tu yogo 'sti na caikāntam anaśnataḥ", en: "Yoga is not for one who eats too much or too little, nor for one who sleeps too much or too little.", src: "6.16" },
  { dev: "यथा दीपो निवातस्थो नेङ्गते सोपमा स्मृता ।\nयोगिनो यतचित्तस्य युञ्जतो योगमात्मनः ॥", tr: "yathā dīpo nivāta-stho neṅgate sopamā smṛtā", en: "As a lamp in a windless place does not flicker — such is the disciplined mind of one absorbed in yoga.", src: "6.19" },
  { dev: "यतो यतो निश्चरति मनश्चञ्चलमस्थिरम् ।\nततस्ततो नियम्यैतदात्मन्येव वशं नयेत् ॥", tr: "yato yato niścarati manaś cañcalam asthiram", en: "Wherever the restless, unsteady mind wanders, from there rein it in and bring it back under the self's control.", src: "6.26" },
  { dev: "अनन्याश्चिन्तयन्तो मां ये जनाः पर्युपासते ।\nतेषां नित्याभियुक्तानां योगक्षेमं वहाम्यहम् ॥", tr: "ananyāś cintayanto māṁ ye janāḥ paryupāsate", en: "To those who are constant and single-minded, I carry what they lack and preserve what they have.", src: "9.22" },
  { dev: "पत्रं पुष्पं फलं तोयं यो मे भक्त्या प्रयच्छति ।\nतदहं भक्त्युपहृतमश्नामि प्रयतात्मनः ॥", tr: "patraṁ puṣpaṁ phalaṁ toyaṁ yo me bhaktyā prayacchati", en: "A leaf, a flower, a fruit, water — offered with devotion by a pure heart, that I accept.", src: "9.26" },
  { dev: "अद्वेष्टा सर्वभूतानां मैत्रः करुण एव च ।\nनिर्ममो निरहङ्कारः समदुःखसुखः क्षमी ॥", tr: "adveṣṭā sarva-bhūtānāṁ maitraḥ karuṇa eva ca", en: "Without hatred toward any being, friendly and compassionate, free of possessiveness and ego, equal in pain and pleasure, patient.", src: "12.13" },
  { dev: "समः शत्रौ च मित्रे च तथा मानापमानयोः ।\nशीतोष्णसुखदुःखेषु समः सङ्गविवर्जितः ॥", tr: "samaḥ śatrau ca mitre ca tathā mānāpamānayoḥ", en: "Alike toward enemy and friend, in honor and dishonor, in cold and heat, pleasure and pain — free from attachment.", src: "12.18" },
  { dev: "अनुद्वेगकरं वाक्यं सत्यं प्रियहितं च यत् ।\nस्वाध्यायाभ्यसनं चैव वाङ्मयं तप उच्यते ॥", tr: "anudvega-karaṁ vākyaṁ satyaṁ priya-hitaṁ ca yat", en: "Speech that agitates none — truthful, kind, and beneficial — and the practice of study: this is the austerity of speech.", src: "17.15" },
  { dev: "इति ते ज्ञानमाख्यातं गुह्याद्गुह्यतरं मया ।\nविमृश्यैतदशेषेण यथेच्छसि तथा कुरु ॥", tr: "iti te jñānam ākhyātaṁ guhyād guhyataraṁ mayā", en: "Thus I have declared to you the most secret of knowledge. Reflect on it fully — then do as you choose.", src: "18.63" },
  { dev: "यत्र योगेश्वरः कृष्णो यत्र पार्थो धनुर्धरः ।\nतत्र श्रीर्विजयो भूतिर्ध्रुवा नीतिर्मतिर्मम ॥", tr: "yatra yogeśvaraḥ kṛṣṇo yatra pārtho dhanur-dharaḥ", en: "Where there is mastery of yoga and where there is the bowman's skill — there fortune, victory, prosperity, and firm justice abide.", src: "18.78" },
];


/* ─── main view ─── */
export function CommandView({
  tasks: initialTasks,
  events,
  log,
  stats,
  weather,
}: {
  tasks: TaskRow[];
  events: EventRow[] | null;
  log: LogRow[];
  stats: Stats;
  weather: WeatherRow | null;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [gi, setGi] = useState(0);
  const [ask, setAsk] = useState("");
  const [askOut, setAskOut] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [focusSec, setFocusSec] = useState(25 * 60);
  const [focusRun, setFocusRun] = useState(false);
  const [taskModal, setTaskModal] = useState(false);

  const now = new Date();
  const open = tasks.filter((t) => t.status !== "done").length;
  const todays = (events ?? []).filter((e) => new Date(e.start).toDateString() === now.toDateString());

  /* gita rotation */
  useEffect(() => {
    const t = setInterval(() => setGi((g) => (g + 1) % GITA.length), 45000);
    return () => clearInterval(t);
  }, []);

  /* focus timer */
  useEffect(() => {
    if (!focusRun) return;
    const t = setInterval(() => setFocusSec((s) => (s > 0 ? s - 1 : 25 * 60)), 1000);
    return () => clearInterval(t);
  }, [focusRun]);

  /* real AI ask (voice brain, text-in text-out) */
  const doAsk = useCallback(async (q: string) => {
    if (!q.trim() || asking) return;
    setAsking(true);
    setAskOut("…");
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: q }),
      });
      // Read as text first: an error page is not JSON, and parsing it blindly
      // turned every server-side failure into a misleading "link error".
      const raw = await res.text();
      let json: { ok?: boolean; error?: string; data?: { text?: string } } | null = null;
      try { json = JSON.parse(raw); } catch { /* not JSON — handled below */ }

      if (json?.data?.text) setAskOut(json.data.text);
      else if (json?.error) setAskOut(json.error);
      else if (!res.ok) setAskOut(`SAGE returned ${res.status}. ${raw.slice(0, 120)}`);
      else setAskOut("No response.");
    } catch (err) {
      setAskOut(err instanceof Error ? `Couldn't reach SAGE: ${err.message}` : "Link error — try again.");
    } finally {
      setAsking(false);
    }
  }, [asking]);

  const toggleTask = async (task: TaskRow) => {
    const status = task.status === "done" ? "todo" : "done";
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
    if (status === "done") {
      sound.blip();
      window.dispatchEvent(new CustomEvent("sage:toast", { detail: { title: "DIRECTIVE COMPLETE", body: task.title, kind: "alert" } }));
    }
    await fetch(`/api/task/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  /* focus ring geometry */
  const fr = 40, fc = 2 * Math.PI * fr;
  const fpct = 1 - focusSec / (25 * 60);
  const gita = GITA[gi];

  /* calendar grid */
  const Y = now.getFullYear(), M = now.getMonth();
  const first = new Date(Y, M, 1), dim = new Date(Y, M + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7, prevDim = new Date(Y, M, 0).getDate();
  const evDays = new Set((events ?? []).map((e) => { const d = new Date(e.start); return d.getMonth() === M ? d.getDate() : -1; }));

  /* Week / day-of-year / quarter, in IST.
     Deriving these from toISOString would put late-evening glances on
     tomorrow's numbers at +05:30 — a clock that is wrong every evening. */
  const dayKeyIst = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
  const istYear = Number(dayKeyIst.slice(0, 4));
  const doy = Math.floor((Date.parse(`${dayKeyIst}T00:00:00Z`) - Date.UTC(istYear, 0, 1)) / 86400000) + 1;
  const week = Math.ceil(doy / 7);
  const quarter = Math.floor(Number(dayKeyIst.slice(5, 7)) / 3.01) + 1;
  const focusMin = Math.round((25 * 60 - focusSec) / 60);
  const agentRunning = log.some((l) => l.type.startsWith("agent."));

  /**
   * How much of the viewport the wall is allowed to have.
   *
   * This was a guessed constant, and a guess is wrong the moment anything
   * above changes height — the desk strip, the ticker, an exam banner that
   * only appears in exam week. Too small and the wall floats; too large and
   * the bottom row paints under the F-key rail, which is exactly how the
   * first pass looked. So it is measured: distance from the top of the
   * viewport to the top of the wall, plus whatever the rail occupies.
   */
  const wallRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fit = () => {
      const el = wallRef.current;
      if (!el) return;
      const rail = document.querySelector<HTMLElement>(".fn-rail");
      const chrome = el.getBoundingClientRect().top + window.scrollY + (rail?.offsetHeight ?? 0);
      el.style.setProperty("--wall-chrome", `${Math.round(chrome)}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    // The strips above can appear after first paint (exam banner, ticker), so
    // one measurement at mount is not enough.
    const ro = new ResizeObserver(fit);
    if (document.body) ro.observe(document.body);
    return () => { window.removeEventListener("resize", fit); ro.disconnect(); };
  }, []);

  return (
    <div className="wall" ref={wallRef}>
      {/* ── ROW 1 ─────────────────────────────────────────────────────────
          The map leads, at the width it earns. */}
      <div className="wall-row wall-r1">
        <Pane n={1} title="Atlas Map" status="LIVE" live className="wall-map" frame>
          <AtlasMap lat={12.9352} lon={77.6245} />
          <span className="deck-map-marks" aria-hidden>
            <Crosshair /><Crosshair /><Crosshair /><Crosshair />
          </span>
        </Pane>
        <TileGuard name="MARKETS"><MarketsTile n={2} /></TileGuard>
        <TileGuard name="KEYMETRICS">
          <KeyMetricsTile n={3} week={week} doy={doy} quarter={quarter} open={open} focusMin={focusMin} />
        </TileGuard>
        <TileGuard name="FEEDS"><FeedsTile n={12} /></TileGuard>
      </div>

      {/* ── ROW 2 ───────────────────────────────────────────────────────── */}
      <div className="wall-row wall-r2">
        <TileGuard name="BIO"><BioTile n={4} /></TileGuard>
        <TileGuard name="HEALTH"><HealthTile n={5} /></TileGuard>
        <TileGuard name="AGENTLOG"><AgentLogTile n={6} /></TileGuard>
        <div className="wall-stack">
          <TileGuard name="ACTIVITY"><ActivityTile n={7} /></TileGuard>
          <Pane
            n={8}
            title="Focus Cycle"
            status={
              <span className="fc-btns">
                <button onClick={() => setFocusRun((r) => !r)}>{focusRun ? "PAUSE" : "START"}</button>
                <button onClick={() => { setFocusRun(false); setFocusSec(25 * 60); }}>RESET</button>
              </span>
            }
            live={focusRun}
          >
            <div className="fring">
              <svg viewBox="0 0 92 92">
                <circle cx="46" cy="46" r={fr} fill="none" stroke="var(--rule)" strokeWidth="2.5" />
                <circle cx="46" cy="46" r={fr} fill="none" stroke="var(--signal)" strokeWidth="2.5" strokeDasharray={fc} strokeDashoffset={fc * (1 - fpct)} transform="rotate(-90 46 46)" strokeLinecap="round" />
              </svg>
              <div>
                <div className="ft2 num">{pad(Math.floor(focusSec / 60))}:{pad(focusSec % 60)}</div>
                <div className="fk">DEEP WORK · POMODORO</div>
              </div>
            </div>
          </Pane>
        </div>
        <TileGuard name="MISSION">
          <MissionTile
            n={9}
            open={open}
            events={todays.length}
            agentRunning={agentRunning}
            memories={stats.memories}
            runs={stats.runs}
            weather={weather ? `${weather.temp}° ${weather.label}` : null}
          />
        </TileGuard>
      </div>

      {/* ── ROW 3 ───────────────────────────────────────────────────────── */}
      <div className="wall-row wall-r3">
        <TileGuard name="EISENHOWER"><div className="wall-cell"><EisenhowerBand /></div></TileGuard>
        <Pane
          n={11}
          title="Deadlines"
          status={<span className="fc-btns"><button onClick={() => setTaskModal(true)}>OPEN</button></span>}
          live={open > 0}
        >
          {tasks.map((t) => (
            <div className={`task${t.status === "done" ? " done" : ""}`} key={t.id} onClick={() => toggleTask(t)}>
              <span className="box" />
              <span className="tx">{t.title}</span>
              <span className="rank">{t.dueAt ? fmt(t.dueAt, { day: "2-digit", month: "short" }).toUpperCase() : "—"}</span>
            </div>
          ))}
          {tasks.length === 0 && <div className="tile-wait">NO OPEN DIRECTIVES</div>}
        </Pane>
        <TileGuard name="GITHUB"><GithubTile n={13} /></TileGuard>
        <TileGuard name="PLAYING"><PlayingTile n={14} /></TileGuard>
      </div>

      {/* ── ROW 4 ─────────────────────────────────────────────────────────
          Nine narrow columns. Each pane's body scrolls inside itself, so a
          long agenda cannot push the wall past the bottom of the screen. */}
      <div className="wall-row wall-r4">
        <TileGuard name="CLOCKS"><ClocksTile n={15} /></TileGuard>
        <TileGuard name="SKY"><SkyTile n={16} /></TileGuard>
        <TileGuard name="DEBRIEF"><div className="wall-cell"><BriefBlock /></div></TileGuard>
        <TileGuard name="SITREP"><div className="wall-cell"><SitrepBand compact /></div></TileGuard>
        <Pane n={19} title="What Now">
          <NextAction />
          <div className="askbox wall-ask">
            <span className="sig" />
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { doAsk(ask); setAsk(""); } }}
              placeholder="Ask Sage…"
            />
          </div>
          <div className="sageout">{asking ? "…" : askOut}</div>
        </Pane>
        <Pane n={20} title="Gita" status={`अध्याय ${gita.src}`} className="gita">
          <button className="nxt" onClick={() => setGi((g) => (g + 1) % GITA.length)}>NEXT →</button>
          <div className="dev">{gita.dev}</div>
          <div className="tr">{gita.tr}</div>
          <div className="en">{gita.en}</div>
        </Pane>
        <Pane n={21} title={`${now.toLocaleString("en", { month: "long" })} ${Y}`}>
          <div className="cal">
            {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((d) => <div className="dh" key={d}>{d}</div>)}
            {Array.from({ length: lead }).map((_, i) => <div className="d out" key={`p${i}`}>{prevDim - lead + 1 + i}</div>)}
            {Array.from({ length: dim }).map((_, i) => (
              <div className={`d${i + 1 === now.getDate() ? " today" : ""}`} key={i}>
                {pad(i + 1)}
                {evDays.has(i + 1) && <span className="ev" />}
              </div>
            ))}
          </div>
        </Pane>
        <TileGuard name="COMMANDS"><CommandsTile n={22} /></TileGuard>
        <TileGuard name="SYSTEM"><SystemTile n={23} /></TileGuard>
      </div>

      <ExpandModal open={taskModal} onClose={() => setTaskModal(false)} title="Directives" tag="ADD · EDIT · REMOVE">
        <TaskManager tasks={tasks} setTasks={setTasks} />
      </ExpandModal>
    </div>
  );
}
