"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "../command.css";
import { NumberTicker } from "@/components/number-ticker";
import { sound } from "@/lib/sound";
import { ExpandModal } from "@/components/expand-modal";
import { TaskManager } from "./task-manager";
import { ExpandableCell } from "./expandable-cell";
import { ScheduleManager } from "./schedule-manager";
import { WorldView } from "@/features/atlas/world-view";
import { tzHour, fmt } from "@/lib/config";

/* ─── data contracts (all real, server-fetched) ─── */
export interface TaskRow { id: string; title: string; status: string; dueAt: string | null }
export interface EventRow { id?: string; summary: string; start: string; allDay?: boolean }
export interface NoteRow { id: string; title: string; createdAt: string }
export interface LogRow { type: string; createdAt: string }
export interface Stats { memories: number; sources: number; runs: number; notes: number }
export interface WeatherRow { temp: number; high: number; low: number; label: string; wind: number; place: string; aqi?: number | null }

const pad = (n: number) => String(n).padStart(2, "0");

const LOG_LABEL: Record<string, string> = {
  "memory.extracted": "memory committed",
  "brief.generated": "brief compiled",
  "reminder.fired": "reminder fired",
  "automation.completed": "automation complete",
};

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
  notes: initialNotes,
  log,
  stats,
  weather,
  steps,
  userName,
}: {
  tasks: TaskRow[];
  events: EventRow[] | null;
  notes: NoteRow[];
  log: LogRow[];
  stats: Stats;
  weather: WeatherRow | null;
  steps?: number | null;
  userName: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [notes, setNotes] = useState(initialNotes);
  const [gi, setGi] = useState(0);
  const [ask, setAsk] = useState("");
  const [askOut, setAskOut] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [focusSec, setFocusSec] = useState(25 * 60);
  const [focusRun, setFocusRun] = useState(false);
  const [taskModal, setTaskModal] = useState(false);

  const now = new Date();
  const hour = tzHour(now);
  const greet = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
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
      const json = await res.json();
      setAskOut(json?.data?.text ?? "No response.");
    } catch {
      setAskOut("Link error — try again.");
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

  const addNote = async () => {
    const text = noteText.trim();
    if (!text) return;
    setNoteText("");
    const res = await fetch("/api/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: text }),
    });
    const { data } = await res.json();
    setNotes((prev) => [{ id: data.id, title: text, createdAt: new Date().toISOString() }, ...prev].slice(0, 6));
    window.dispatchEvent(new CustomEvent("sage:toast", { detail: { title: "NOTE CAPTURED", body: text } }));
    router.refresh();
  };

  const delNote = async (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/note/${id}`, { method: "DELETE" });
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

  return (
    <div>
      {/* ================= 01 HOME ================= */}
      <section className="section" id="home">
        <div className="sectitle"><span className="sn">01</span><h2>Home</h2><span className="line" /><span className="tag">ASSISTANT · NOTES · GITA · AGENDA</span></div>
        <div className="grid deck1">
          {/* left */}
          <div className="stack">
            <ExpandableCell title="Intelligence" tag="MEMORY CORE">
              <div className="bh"><span className="t">Intelligence</span><span className="i">MEM</span><span className="r">LIVE</span></div>
              <div className="counters" style={{ margin: 0 }}>
                <div className="ct"><div className="cv num"><NumberTicker value={stats.memories} /></div><div className="ck">Memories</div></div>
                <div className="ct"><div className="cv num"><NumberTicker value={stats.sources} /></div><div className="ck">Sources</div></div>
                <div className="ct"><div className="cv num"><NumberTicker value={stats.runs} /></div><div className="ck">Agent runs</div></div>
                <div className="ct"><div className="cv num"><NumberTicker value={stats.notes} /></div><div className="ck">Notes</div></div>
              </div>
            </ExpandableCell>
            <ExpandableCell title="Notes" tag="ADD · REMOVE" style={{ flex: 1 }}>
              <div className="bh"><span className="t">Notes</span><span className="i">NTS</span><span className="r">{pad(notes.length)}</span></div>
              <div className="notein">
                <input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} placeholder="capture a thought…" />
                <button onClick={addNote}>ADD</button>
              </div>
              {notes.map((n) => (
                <div className="note" key={n.id}>
                  <span className="nb" />
                  <div style={{ flex: 1 }}>
                    <div className="ntx">{n.title}</div>
                    <div className="nt2">{fmt(n.createdAt, { hour: "2-digit", minute: "2-digit", hour12: false })}</div>
                  </div>
                  <button className="del" onClick={() => delNote(n.id)}>×</button>
                </div>
              ))}
            </ExpandableCell>
          </div>

          {/* center — interactive Google-Earth-style intelligence globe */}
          <div className="stack">
            <div className="cell hero hero-globe-cell">
              <WorldView lat={18} lon={78} />
              <div className="greeting">
                <div className="g1">Sage · Online</div>
                <div className="g2">{greet}, {userName}</div>
                <div className="g3">
                  {weather ? `${weather.place} ${weather.temp}° · ${weather.label} · ` : ""}
                  {todays.length} events today · {open} open
                </div>
              </div>
              <div className="vitrow">
                {weather && (
                  <>
                    <div className="vv num">{weather.temp}°</div>
                    <div className="vk">
                      {weather.place} · {weather.high}°/{weather.low}°
                      {typeof weather.aqi === "number" ? ` · AQI ${weather.aqi}` : ""}
                    </div>
                    <div className="dv" />
                  </>
                )}
                <div className="vv num">{open}</div><div className="vk">Open</div>
                <div className="dv" />
                <div className="vv num">{todays.length}</div><div className="vk">Events</div>
                {typeof steps === "number" && steps > 0 && (
                  <>
                    <div className="dv" />
                    <div className="vv num"><NumberTicker value={steps} /></div>
                    <div className="vk">Steps</div>
                  </>
                )}
              </div>
            </div>
            <div className="cell ask">
              <div className="askbox">
                <span className="sig" />
                <input
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { doAsk(ask); setAsk(""); } }}
                  placeholder="Ask Sage anything…"
                />
                <span className="kb">↵</span>
              </div>
              <div className="chips">
                {["What's my plan today?", "Summarize my unread email", "What do you know about me?", "Any tasks due soon?"].map((q) => (
                  <button key={q} className="chip" onClick={() => doAsk(q)}>{q}</button>
                ))}
              </div>
              <div className="sageout">{asking ? "…" : askOut && <><b>Sage:</b> {askOut}</>}</div>
            </div>
          </div>

          {/* right */}
          <div className="stack right">
            <ExpandableCell title="Bhagavad Gita" tag="श्लोक" className="gita">
              <div className="bh"><span className="t">Gita</span><span className="i">श्लोक</span></div>
              <button className="nxt" onClick={() => setGi((g) => (g + 1) % GITA.length)}>NEXT →</button>
              <div className="dev">{gita.dev}</div>
              <div className="tr">{gita.tr}</div>
              <div className="en">{gita.en}</div>
              <div className="src"><span>अध्याय {gita.src}</span><i /><span>BHAGAVAD GITA</span></div>
            </ExpandableCell>
            <ExpandableCell title={`${now.toLocaleString("en", { month: "long" })} ${Y}`} tag="CALENDAR">
              <div className="bh"><span className="t">{now.toLocaleString("en", { month: "long" }).toUpperCase()} {Y}</span><span className="i">CAL</span></div>
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
            </ExpandableCell>
            <ExpandableCell title="Agenda" tag="ADD · REMOVE" style={{ flex: 1 }} expanded={<ScheduleManager events={events} />}>
              <div className="bh"><span className="t">Agenda</span><span className="i">AGD</span><span className="r">{events ? "LIVE" : "OFFLINE"}</span></div>
              {(events ?? []).slice(0, 4).map((e, i) => {
                const d = new Date(e.start);
                const isNext = i === 0;
                return (
                  <div className={`ag${isNext ? " now" : ""}`} key={i}>
                    <span className="tm">
                      {fmt(d, { weekday: "short" }).toUpperCase()}{" "}
                      {e.allDay ? "ALL DAY" : fmt(d, { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </span>
                    <span className="mk2"><i /></span>
                    <div><div className="en2">{e.summary}</div><div className="el2">{isNext ? "NEXT" : "SCHEDULED"}</div></div>
                  </div>
                );
              })}
              {events !== null && events.length === 0 && <p className="lbl">NO UPCOMING EVENTS</p>}
              {events === null && <p className="lbl">CONNECT GOOGLE IN SETTINGS</p>}
            </ExpandableCell>
          </div>
        </div>
      </section>

      {/* ================= 02 EXECUTE ================= */}
      <section className="section" id="exec" style={{ paddingTop: 0 }}>
        <div className="sectitle"><span className="sn">02</span><h2>Execute</h2><span className="line" /><span className="tag">DIRECTIVES · FOCUS · ACTIVITY</span></div>
        <div className="grid deck2a">
          <div className="cell expandable" onClick={() => setTaskModal(true)}>
            <div className="bh">
              <span className="t">Directives</span><span className="i">TSK</span>
              <span className="r">{tasks.filter((t) => t.status === "done").length}/{tasks.length} · <span className="expand-hint">MANAGE ⤢</span></span>
            </div>
            {tasks.map((t, i) => (
              <div className={`task${t.status === "done" ? " done" : ""}`} key={t.id} onClick={(e) => { e.stopPropagation(); toggleTask(t); }}>
                <span className="box" /><span className="tx">{t.title}</span><span className="rank">{pad(i + 1)}</span>
              </div>
            ))}
            {tasks.length === 0 && <p className="lbl">NO OPEN DIRECTIVES — TAP TO ADD</p>}
          </div>
          <ExpandableCell title="Focus Cycle" tag="POMODORO">
            <div className="bh">
              <span className="t">Focus Cycle</span><span className="i">FCS</span>
              <span className="r" style={{ display: "flex", gap: 10 }}>
                <button className="lbl" style={{ cursor: "pointer" }} onClick={() => setFocusRun((r) => !r)}>{focusRun ? "PAUSE" : "START"}</button>
                <button className="lbl" style={{ cursor: "pointer" }} onClick={() => { setFocusRun(false); setFocusSec(25 * 60); }}>RESET</button>
              </span>
            </div>
            <div className="fring">
              <svg viewBox="0 0 92 92">
                <circle cx="46" cy="46" r={fr} fill="none" stroke="#2c2c30" strokeWidth="2.5" />
                <circle cx="46" cy="46" r={fr} fill="none" stroke="#f4f4f5" strokeWidth="2.5" strokeDasharray={fc} strokeDashoffset={fc * (1 - fpct)} transform="rotate(-90 46 46)" strokeLinecap="round" />
                <circle cx="46" cy="46" r="31" fill="none" stroke="#1c1c1f" strokeWidth="1" strokeDasharray="2 4" />
              </svg>
              <div>
                <div className="ft2 num">{pad(Math.floor(focusSec / 60))}:{pad(focusSec % 60)}</div>
                <div className="fk">DEEP WORK · POMODORO</div>
              </div>
            </div>
            <div className="counters">
              <div className="ct"><div className="cv num">{open}</div><div className="ck">Open</div></div>
              <div className="ct"><div className="cv num">{tasks.filter((t) => t.status === "done").length}</div><div className="ck">Done</div></div>
              <div className="ct"><div className="cv num">{todays.length}</div><div className="ck">Events</div></div>
              <div className="ct"><div className="cv num">{stats.runs}</div><div className="ck">Runs</div></div>
            </div>
          </ExpandableCell>
          <ExpandableCell title="Activity" tag="SYSTEM LOG" className="!flex flex-col">
            <div className="bh"><span className="t">Activity</span><span className="i">LOG</span><span className="r">SYSTEM</span></div>
            <div className="feed">
              {log.map((row, i) => (
                <div className="fr" key={i}>
                  <span className="ft">{fmt(row.createdAt, { hour: "2-digit", minute: "2-digit", hour12: false })}</span>{" "}
                  <span className={i === 0 ? "fh" : ""}>{LOG_LABEL[row.type] ?? row.type}</span>
                </div>
              ))}
              {log.length === 0 && <div className="fr"><span className="ft">—</span> no activity yet</div>}
            </div>
          </ExpandableCell>
        </div>
      </section>

      <ExpandModal open={taskModal} onClose={() => setTaskModal(false)} title="Directives" tag="ADD · EDIT · REMOVE">
        <TaskManager tasks={tasks} setTasks={setTasks} />
      </ExpandModal>
    </div>
  );
}
