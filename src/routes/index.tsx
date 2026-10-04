import { createFileRoute, useHydrated } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ATHKAR, RADIO, AZAN_URL, PRAYER_AR, CITIES,
  normalizeAr, qiblaBearing, chime, type Track,
} from "@/lib/anees-config";
import { CLIP_KEYS, getClip, saveClip, removeClip, recordClip } from "@/lib/voice-clips";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "أَنِيس — رفيقك الإسلامي الصوتي لكبار السن" },
      { name: "description", content: "قرآن، أذكار، محاضرات، مواقيت الصلاة والقبلة — بالصوت فقط، بدون قراءة." },
      { property: "og:title", content: "أَنِيس — رفيقك الإسلامي الصوتي" },
      { property: "og:description", content: "تطبيق صوتي بالكامل لكبار السن: القرآن والأذكار والمواقيت والقبلة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Anees,
});

type View = "home" | "quran" | "athkar" | "radio" | "prayer" | "qibla";
type Ayah = { text: string; audio: string; numberInSurah: number };
type SurahMeta = { number: number; name: string };
const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onspeechend?: (() => void) | null; onerror: (() => void) | null;
};

function Anees() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<SR | null>(null);
  const queueRef = useRef<Track[]>([]);
  const idxRef = useRef(0);
  const repeatRef = useRef(false);

  const [view, setView] = useState<View>("home");
  const [listening, setListening] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [heard, setHeard] = useState("");
  const [nowLabel, setNowLabel] = useState("");
  const [idx, setIdx] = useState(0);
  const [repeat, setRepeat] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState("");
  const startLoading = (msg: string) => { setLoading(msg); chime(1); };
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const geoTried = useRef(false);

  const [surahs, setSurahs] = useState<SurahMeta[]>([]);
  const [surah, setSurah] = useState<{ name: string; ayahs: Ayah[] } | null>(null);
  const [athkarKey, setAthkarKey] = useState("morning");

  const [cityId, setCityId] = useState("tripoli");
  const city = CITIES.find((c) => c.id === cityId)!;
  const [timings, setTimings] = useState<Record<string, string> | null>(null);
  const [azanAlert, setAzanAlert] = useState("");
  const [heading, setHeading] = useState<number | null>(null);
  const qiblaOkRef = useRef(false);
  const [aligned, setAligned] = useState(false);
  const diffRef = useRef(180);
  useEffect(() => {
    if (view !== "qibla") return;
    let stop = false; let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (stop) return;
      const d = diffRef.current;
      if (d >= 8 && d < 90 && !playing) chime(1);
      t = setTimeout(tick, d < 8 ? 600 : 300 + d * 15);
    };
    t = setTimeout(tick, 1500);
    return () => { stop = true; clearTimeout(t); };
  }, [view, playing]);

  // ---------- speech ----------
  const handleRef = useRef<(t: string) => void>(() => {});
  const startListening = useCallback(() => {
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) { setNotice("المتصفح لا يدعم الأوامر الصوتية — استخدم Chrome"); return; }
    try { recRef.current?.abort(); } catch { /* */ }
    const r = new Ctor();
    r.lang = "ar-SA"; r.continuous = false; r.interimResults = false;
    r.onspeechend = () => startLoading("جَارٍ فَهْمُ كَلَامِكَ...");
    r.onresult = (e) => { setLoading(""); const t = e.results[0]![0]!.transcript; setHeard(t); handleRef.current(t); };
    r.onend = () => { setListening(false); setLoading((l) => (l.startsWith("جَارٍ فَهْمُ") ? "" : l)); };
    r.onerror = () => setListening(false);
    recRef.current = r;
    try { r.start(); setListening(true); } catch { setListening(false); }
  }, []);
  const stopListening = () => { try { recRef.current?.abort(); } catch { /* */ } setListening(false); };

  // ---------- player ----------
  const playAt = useCallback((i: number) => {
    const a = audioRef.current; const t = queueRef.current[i];
    if (!a || !t) return;
    idxRef.current = i; setIdx(i); setNowLabel(t.label);
    a.src = t.url; a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, []);

  const listenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenLater = useCallback((ms: number) => {
    if (listenTimer.current) clearTimeout(listenTimer.current);
    listenTimer.current = setTimeout(startListening, ms);
  }, [startListening]);

  const playQueue = useCallback((tracks: Track[], start = 0) => {
    stopListening();
    if (listenTimer.current) clearTimeout(listenTimer.current);
    const a = audioRef.current; if (a) { a.pause(); a.removeAttribute("src"); a.load(); }
    repeatRef.current = false; setRepeat(false);
    const valid = tracks.filter((t) => t.url);
    if (!valid.length) {
      chime(); setNotice("لم تُضَف تسجيلات صوتية لهذا القسم بعد");
      listenLater(1500); return;
    }
    setNotice(""); queueRef.current = valid; playAt(Math.min(start, valid.length - 1));
  }, [playAt, listenLater]);

  const stopAudio = () => { audioRef.current?.pause(); setPlaying(false); };

  useEffect(() => {
    const a = new Audio(); audioRef.current = a;
    a.onended = () => {
      if (repeatRef.current) { a.currentTime = 0; a.play(); return; }
      const n = idxRef.current + 1;
      if (n < queueRef.current.length) playAt(n);
      else { setPlaying(false); startListening(); }
    };
    a.onpause = () => setPlaying(false);
    a.onplay = () => setPlaying(true);
    a.onerror = () => { const n = idxRef.current + 1; if (n < queueRef.current.length) playAt(n); else setPlaying(false); };
    fetch("https://api.alquran.cloud/v1/surah").then((r) => r.json()).then((d) => setSurahs(d.data)).catch(() => {});
    return () => { a.pause(); };
  }, [playAt, startListening]);

  const toggleRepeat = () => { repeatRef.current = !repeatRef.current; setRepeat(repeatRef.current); };

  // ---------- modules ----------
  const openSurah = useCallback(async (n: number) => {
    setView("quran"); setSurah(null); startLoading("جَارٍ تَحْمِيلُ السُّورَةِ...");
    const d = await fetch(`https://api.alquran.cloud/v1/surah/${n}/ar.ahmedajamy`).then((r) => r.json()).finally(() => setLoading(""));
    const s = { name: d.data.name, ayahs: d.data.ayahs as Ayah[] };
    setSurah(s);
    playQueue(s.ayahs.map((a) => ({ url: a.audio, label: `${s.name} — آية ${a.numberInSurah}` })));
  }, [playQueue]);

  const openAthkar = (k: string) => { setView("athkar"); setAthkarKey(k); playQueue(ATHKAR[k]!.tracks); };
  const openRadio = () => { setView("radio"); playQueue(RADIO.flatMap((r) => r.tracks)); };

  const nextPrayer = useCallback(() => {
    if (!timings) return null;
    const now = new Date();
    for (const p of [...PRAYERS, "Fajr+"]) {
      const key = p.replace("+", "");
      const [h, m] = timings[key]!.split(":").map(Number) as [number, number];
      const d = new Date(now); d.setHours(h, m, 0, 0);
      if (p === "Fajr+") d.setDate(d.getDate() + 1);
      if (d > now) { const mins = Math.round((d.getTime() - now.getTime()) / 60000); return { key, h: Math.floor(mins / 60), m: mins % 60 }; }
    }
    return null;
  }, [timings]);

  const locate = (force = false) => {
    if ((geoTried.current && !force) || !navigator.geolocation) return;
    geoTried.current = true; startLoading("جَارٍ تَحْدِيدُ مَوْقِعِكَ...");
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }); setLoading(""); },
      () => setLoading(""), { timeout: 10000 },
    );
  };
  const playPrayerClip = (key: string) => {
    const clip = getClip(key);
    if (clip) playQueue([{ url: clip, label: PRAYER_AR[key] ?? "" }]); else chime(PRAYERS.indexOf(key) + 1);
  };
  const pendingAnnounce = useRef(false);
  const announcePrayer = useCallback(() => {
    const np = nextPrayer(); if (!np) return;
    const clip = getClip(np.key);
    if (!clip) { const n = PRAYERS.indexOf(np.key) + 1; chime(n); setNotice(`${n} نَغَمَات = ${PRAYER_AR[np.key]} — سَجِّلِ الصَّوْتَ مِنْ «تَسْجِيلُ الأَصْوَاتِ»`); listenLater(n * 450 + 1500); return; }
    playQueue([{ url: clip, label: `الصلاة القادمة: ${PRAYER_AR[np.key]}` }]);
  }, [nextPrayer, playQueue, listenLater]);

  useEffect(() => { if (timings && pendingAnnounce.current) { pendingAnnounce.current = false; announcePrayer(); } }, [timings, announcePrayer]);
  const openPrayer = () => { setView("prayer"); locate(); if (timings) announcePrayer(); else pendingAnnounce.current = true; };

  useEffect(() => {
    setTimings(null); startLoading("جَارٍ تَحْمِيلُ مَوَاقِيتِ الصَّلَاةِ...");
    const url = coords
      ? `https://api.aladhan.com/v1/timings?latitude=${coords.lat}&longitude=${coords.lon}&method=3`
      : `https://api.aladhan.com/v1/timingsByCity?city=${city.city}&country=${city.country}&method=3`;
    fetch(url).then((r) => r.json()).then((d) => setTimings(d.data.timings)).catch(() => {}).finally(() => setLoading(""));
  }, [city.city, city.country, coords]);

  // Azan alert
  useEffect(() => {
    if (!timings) return;
    let last = "";
    const t = setInterval(() => {
      const now = new Date(); const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const p = PRAYERS.find((k) => timings[k] === hm);
      if (p && last !== hm) { last = hm; setAzanAlert(PRAYER_AR[p] ?? ""); playQueue([{ url: AZAN_URL, label: `أذان ${PRAYER_AR[p]}` }]); }
    }, 1000);
    return () => clearInterval(t);
  }, [timings, playQueue]);

  // Qibla
  const qibla = coords ? qiblaBearing(coords.lat, coords.lon) : qiblaBearing(city.lat, city.lon);
  const openQibla = async () => {
    setView("qibla"); qiblaOkRef.current = false;
    const g = getClip("qiblaGuide"); if (g) playQueue([{ url: g, label: "أدر الهاتف ببطء" }]); else { stopAudio(); chime(1); }
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (DOE?.requestPermission) { try { await DOE.requestPermission(); } catch { /* */ } }
  };
  useEffect(() => {
    if (view !== "qibla") return;
    const h = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      const hd = e.webkitCompassHeading ?? (e.alpha != null ? (360 - e.alpha) % 360 : null);
      if (hd != null) setHeading(hd);
    };
    window.addEventListener("deviceorientationabsolute", h as EventListener);
    window.addEventListener("deviceorientation", h as EventListener);
    return () => { window.removeEventListener("deviceorientationabsolute", h as EventListener); window.removeEventListener("deviceorientation", h as EventListener); };
  }, [view]);
  useEffect(() => {
    if (heading == null) return;
    const diff = Math.abs(((qibla - heading + 540) % 360) - 180);
    const ok = diff < 8; setAligned(ok);
    if (ok && !qiblaOkRef.current) { qiblaOkRef.current = true; chime(); const q = getClip("qibla"); if (q) playQueue([{ url: q, label: "اتجاه القبلة صحيح" }]); }
    if (diff > 20) qiblaOkRef.current = false;
    diffRef.current = diff;
  }, [heading, qibla, playQueue]);

  // ---------- command router ----------
  handleRef.current = (raw: string) => {
    const t = normalizeAr(raw);
    const has = (...w: string[]) => w.some((x) => t.includes(normalizeAr(x)));
    if (has("تكرار", "كرر", "اعاده")) { toggleRepeat(); return; }
    if (has("توقف", "اسكت", "قف")) { stopAudio(); return; }
    if (has("الرئيسيه", "رجوع")) { stopAudio(); setView("home"); return; }
    // Surah by name anywhere in a natural sentence ("افتحلي سورة الملك", "ابي اسمع يس")
    const strip = (x: string) => normalizeAr(x).replace(/^سوره\s*/, "").replace(/^ال/, "");
    const words = t.split(/\s+/).map((w) => w.replace(/^(و|ف)?ال/, ""));
    const named = surahs.find((x) => { const n = strip(x.name); return n.length >= 2 && (has("سوره") ? words.includes(n) || t.includes("سوره " + normalizeAr(x.name).replace(/^سوره\s*/, "")) : n.length >= 3 && words.includes(n)); });
    if (named && !has("اذكار", "ذكر")) { openSurah(named.number); return; }
    if (has("قبله", "كعبه", "اتجاه")) { openQibla(); return; }
    if (has("مواقيت", "صلاه", "اذان", "وقت", "باقي", "متي", "فجر", "ظهر", "عصر", "مغرب", "عشاء")) { openPrayer(); return; }
    if (has("صباح", "الصبح")) return openAthkar("morning");
    if (has("مساء")) return openAthkar("evening");
    if (has("نوم", "انام", "النوم")) return openAthkar("sleep");
    if (has("ورد", "اطراف")) return openAthkar("wird");
    if (has("اذكار", "ذكر", "اذكر")) return openAthkar("morning");
    if (has("محاضر", "درس", "دروس", "راديو", "فتوى", "فتاوي", "فتاوى", "موعظه", "مواعظ", "عثيمين", "شيخ")) return openRadio();
    if (has("سوره")) {
      const q = t.replace(/.*سوره\s*/, "").replace(/^ال/, "").trim();
      const s = surahs.find((x) => { const n = normalizeAr(x.name).replace(/^سوره\s*/, "").replace(/^ال/, ""); return q && (n.startsWith(q) || q.startsWith(n)); });
      openSurah(s ? s.number : 1); return;
    }
    if (has("قران", "قرءان", "سوره", "مصحف", "تلاوه")) { openSurah(1); return; }
    chime(); setNotice("لم أفهم، حاول مرة أخرى"); listenLater(1200);
  };

  const np = nextPrayer();

  // ---------- UI ----------
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-5xl font-bold text-gold">أَنِيس</h1>
        {view !== "home" && (
          <button onClick={() => { stopAudio(); setView("home"); }} className="rounded-2xl border-4 border-gold bg-card px-6 py-3 text-2xl font-bold text-card-foreground">
            الرَّئِيسِيَّةُ ←
          </button>
        )}
      </header>

      <MicButton listening={listening} playing={playing} onClick={() => (listening ? stopListening() : (stopAudio(), startListening()))} />
      {loading && <Spinner label={loading} />}
      {(heard || notice || nowLabel) && (
        <div className="text-center text-2xl leading-relaxed">
          {heard && <p className="opacity-80">سَمِعْتُ: «{heard}»</p>}
          {notice && <p className="font-bold text-gold">{notice}</p>}
          {playing && nowLabel && <p className="font-bold">▶ {nowLabel}</p>}
        </div>
      )}

      {view === "home" && (
        <div className="grid gap-5">
          <Card title="القُرْآنُ الكَرِيمُ" sub="الشَّيْخُ أَحْمَدُ العَجَمِي" icon="📖" onClick={() => openSurah(1)} />
          <Card title="الأَذْكَارُ" sub="الشَّيْخُ مِشَارِي العَفَاسِي" icon="📿" onClick={() => openAthkar("morning")} />
          <Card title="المُحَاضَرَاتُ (رَادْيُو الدُّرُوسِ وَالمَوَاعِظِ)" sub="الشَّيْخُ ابْنُ عُثَيْمِين" icon="📻" onClick={openRadio} />
          <Card title="مَوَاقِيتُ الصَّلَاةِ وَالقِبْلَةِ" sub={city.ar} icon="🕌" onClick={openPrayer} />
        </div>
      )}

      {view === "quran" && (
        <section className="rounded-3xl border-4 border-gold bg-card p-6 text-card-foreground">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-4xl font-bold">{surah?.name ?? "جَارٍ التَّحْمِيلُ..."}</h2>
            <span className="text-xl text-muted-foreground">الشَّيْخُ أَحْمَدُ العَجَمِي</span>
          </div>
          <div className="mb-4 flex flex-wrap gap-3">
            <BigBtn onClick={toggleRepeat} active={repeat}>{repeat ? "🔁 التَّكْرَارُ مُفَعَّلٌ" : "🔁 كَرِّرِ الآيَةَ"}</BigBtn>
            <BigBtn onClick={() => (playing ? stopAudio() : audioRef.current?.play())}>{playing ? "⏸ إِيقَافٌ" : "▶ تَشْغِيلٌ"}</BigBtn>
            <select value="" onChange={(e) => openSurah(Number(e.target.value))} className="rounded-2xl border-4 border-gold bg-card px-4 py-3 text-2xl">
              <option value="">اخْتَرْ سُورَةً</option>
              {surahs.map((s) => <option key={s.number} value={s.number}>{s.number}. {s.name}</option>)}
            </select>
          </div>
          <div className="font-quran text-4xl leading-[2.4]">
            {surah?.ayahs.map((a, i) => (
              <span key={i} onClick={() => playAt(i)} className={`cursor-pointer rounded-xl px-1 ${i === idx ? "bg-gold text-gold-foreground" : ""}`}>
                {a.text} <span className="text-2xl text-primary">﴿{a.numberInSurah}﴾</span>{" "}
              </span>
            ))}
          </div>
        </section>
      )}

      {view === "athkar" && (
        <section className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(ATHKAR).map(([k, v]) => (
              <BigBtn key={k} active={k === athkarKey} onClick={() => openAthkar(k)}>{v.title}</BigBtn>
            ))}
          </div>
          <List tracks={ATHKAR[athkarKey]!.tracks} current={playing ? nowLabel : ""} onPick={(i) => playQueue(ATHKAR[athkarKey]!.tracks, i)} sub="الشَّيْخُ مِشَارِي العَفَاسِي" />
        </section>
      )}

      {view === "radio" && (
        <section className="rounded-3xl border-4 border-gold bg-card p-6 text-card-foreground">
          <h2 className="text-3xl font-bold">📻 رَادْيُو الدُّرُوسِ وَالمَوَاعِظِ — نُورٌ عَلَى الدَّرْبِ</h2>
          <p className="mb-4 text-xl text-muted-foreground">الشَّيْخُ مُحَمَّدُ بْنُ صَالِحٍ ابْنُ عُثَيْمِين</p>
          <div className="mb-4 flex gap-3">
            <BigBtn onClick={() => (playing ? stopAudio() : openRadio())}>{playing ? "⏸ إِيقَافٌ" : "▶ تَشْغِيلُ البَثِّ"}</BigBtn>
          </div>
          <div className="grid gap-3">
            {RADIO.map((r) => (
              <button key={r.title} onClick={() => playQueue(r.tracks)} className="rounded-2xl bg-muted p-4 text-right">
                <p className="text-2xl font-bold">{r.title}</p>
                <p className="text-lg text-muted-foreground">{r.tracks[0]!.label}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {view === "prayer" && (
        <section className="grid gap-4">
          <div className="rounded-3xl border-4 border-gold bg-card p-6 text-card-foreground">
            <select value={cityId} onChange={(e) => setCityId(e.target.value)} className="mb-4 w-full rounded-2xl border-4 border-gold bg-card px-4 py-3 text-2xl">
              {CITIES.map((c) => <option key={c.id} value={c.id}>{c.ar}</option>)}
            </select>
            <BigBtn onClick={() => { geoTried.current = false; locate(true); }}>📍 اسْتَخْدِمْ مَوْقِعِي الحَالِيَّ {coords ? "✅" : ""}</BigBtn>
            {np && (
              <p className="my-4 text-center text-3xl font-bold text-primary">
                الصَّلَاةُ القَادِمَةُ: {PRAYER_AR[np.key]} بَعْدَ {np.h ? `${np.h} سَاعَة و` : ""}{np.m} دَقِيقَة
              </p>
            )}
            <div className="grid gap-2">
              {timings ? ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"].map((p) => (
                <button key={p} onClick={() => (p === "Sunrise" ? chime(1) : playPrayerClip(p))} className={`flex min-h-20 justify-between rounded-2xl p-5 text-right text-3xl font-bold ${np?.key === p ? "bg-gold text-gold-foreground" : "bg-muted"}`}>
                  <span>{p === "Sunrise" ? "الشُّرُوقُ" : PRAYER_AR[p]}</span><span>{fmt12(timings[p] ?? "")}</span>
                </button>
              )) : <Spinner label="جَارٍ تَحْمِيلُ المَوَاقِيتِ..." />}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <BigBtn onClick={announcePrayer}>🔊 اسْتَمِعْ لِلْمَوْعِدِ</BigBtn>
              <BigBtn onClick={openQibla}>🧭 اتِّجَاهُ القِبْلَةِ</BigBtn>
            </div>
          </div>
          <ClipRecorder />
        </section>
      )}

      {view === "qibla" && (
        <section className={`flex flex-col items-center gap-4 rounded-3xl border-4 p-6 ${aligned ? "border-gold bg-gold text-gold-foreground" : "border-gold bg-card text-card-foreground"}`}>
          <h2 className="text-3xl font-bold">{aligned ? "✅ اتِّجَاهُ القِبْلَةِ صَحِيحٌ" : "أَدِرِ الهَاتِفَ بِبُطْءٍ"}</h2>
          <div className="relative h-72 w-72 rounded-full border-8 border-primary bg-muted">
            <div className="absolute inset-0 transition-transform" style={{ transform: `rotate(${qibla - (heading ?? 0)}deg)` }}>
              <div className="absolute left-1/2 top-2 -translate-x-1/2 text-6xl">🕋</div>
              <div className="absolute left-1/2 top-16 h-24 w-3 -translate-x-1/2 rounded-full bg-primary" />
            </div>
          </div>
          <p className="text-2xl">القِبْلَةُ: {Math.round(qibla)}° — {city.ar}</p>
          {heading == null && <p className="text-xl">افْتَحِ التَّطْبِيقَ مِنَ الهَاتِفِ لِتَفْعِيلِ البُوصْلَةِ</p>}
        </section>
      )}

      {azanAlert && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-primary p-6 text-center">
          <p className="text-6xl font-bold text-gold">حَانَ وَقْتُ صَلَاةِ {azanAlert}</p>
          <BigBtn onClick={() => { setAzanAlert(""); stopAudio(); }}>إِغْلَاقٌ</BigBtn>
        </div>
      )}
      <footer className="mt-auto border-t-2 border-gold/40 pt-4 text-center text-base leading-relaxed opacity-80">
        {view === "quran" && "المَصْدَرُ: نَصُّ المُصْحَفِ العُثْمَانِيِّ (Tanzil عبر AlQuran.cloud) — التِّلَاوَةُ: الشَّيْخُ أَحْمَدُ العَجَمِي (Islamic Network)"}
        {view === "athkar" && "المَصْدَرُ: أَذْكَارُ حِصْنِ المُسْلِمِ بِصَوْتِ الشَّيْخِ مِشَارِي العَفَاسِي (أَرْشِيفُ الإِنْتَرْنِت Archive.org)"}
        {view === "radio" && "المَصْدَرُ: فَتَاوَى نُورٌ عَلَى الدَّرْبِ — المَكْتَبَةُ الصَّوْتِيَّةُ لِلشَّيْخِ ابْنِ عُثَيْمِين (Archive.org)"}
        {(view === "prayer" || view === "qibla") && "المَصْدَرُ: مَوَاقِيتُ AlAdhan.com — طَرِيقَةُ رَابِطَةِ العَالَمِ الإِسْلَامِيِّ — الأَذَانُ: IslamCan"}
        {view === "home" && "القُرْآنُ: الشَّيْخُ العَجَمِي • الأَذْكَارُ: الشَّيْخُ العَفَاسِي • الدُّرُوسُ: الشَّيْخُ ابْنُ عُثَيْمِين • المَوَاقِيتُ: AlAdhan"}
      </footer>
    </main>
  );
}

function fmt12(hm: string) {
  const [h, m] = hm.split(" ")[0]!.split(":").map(Number) as [number, number];
  if (Number.isNaN(h)) return hm;
  const suffix = h < 12 ? "ص" : "م";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-4 py-3 text-2xl font-bold">
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-gold border-t-transparent" />
      <span className="animate-pulse">{label}</span>
    </div>
  );
}

function MicButton({ listening, playing, onClick }: { listening: boolean; playing: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`mx-auto flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-full border-8 p-6 text-center transition-colors ${
        listening ? "mic-pulse border-live bg-live text-live-foreground" : "border-gold bg-primary text-primary-foreground"
      }`}
    >
      <span className="text-7xl">🎙️</span>
      <span className="text-2xl font-bold leading-snug">
        {listening ? "تَكَلَّمْ الآنَ.. أَنِيس يَسْتَمِعُ إِلَيْك" : playing ? "إِنْصِتْ لِلْقِرَاءَةِ" : "إِضْغَطْ أَوْ تَكَلَّمْ"}
      </span>
    </button>
  );
}

function Card({ title, sub, icon, onClick }: { title: string; sub: string; icon: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-36 w-full items-center gap-6 rounded-3xl border-4 border-gold bg-card p-7 text-right text-card-foreground shadow-xl active:scale-[0.98]">
      <span className="text-7xl">{icon}</span>
      <span>
        <span className="block text-3xl font-bold">{title}</span>
        <span className="block text-2xl text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

function BigBtn({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`min-h-16 rounded-2xl border-4 border-gold px-6 py-4 text-2xl font-bold ${active ? "bg-gold text-gold-foreground" : "bg-primary text-primary-foreground"}`}>
      {children}
    </button>
  );
}

function List({ tracks, current, onPick, sub }: { tracks: Track[]; current: string; onPick: (i: number) => void; sub: string }) {
  return (
    <div className="rounded-3xl border-4 border-gold bg-card p-4 text-card-foreground">
      <p className="mb-3 text-xl text-muted-foreground">{sub}</p>
      <div className="grid gap-2">
        {tracks.map((t, i) => (
          <button key={i} onClick={() => onPick(i)} className={`rounded-2xl p-4 text-right text-2xl font-bold ${current === t.label ? "bg-gold text-gold-foreground" : "bg-muted"}`}>
            ▶ {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClipRecorder() {
  const [, force] = useState(0);
  const hydrated = useHydrated();
  const [rec, setRec] = useState<{ key: string; stop: () => Promise<string> } | null>(null);
  const [err, setErr] = useState("");
  const start = async (key: string) => {
    try { setErr(""); const r = await recordClip(); setRec({ key, stop: r.stop }); }
    catch { setErr("لَمْ يُسْمَحْ بِاسْتِخْدَامِ المِيكْرُوفُونِ"); }
  };
  const stop = async () => { if (!rec) return; const url = await rec.stop(); saveClip(rec.key, url); setRec(null); force((n) => n + 1); };
  return (
    <details className="rounded-3xl border-4 border-gold bg-card p-5 text-card-foreground">
      <summary className="cursor-pointer text-2xl font-bold">🎤 تَسْجِيلُ الأَصْوَاتِ (لِأَحَدِ أَفْرَادِ العَائِلَةِ)</summary>
      <p className="my-3 text-lg text-muted-foreground">سَجِّلْ كُلَّ جُمْلَةٍ بِصَوْتِكَ مَرَّةً وَاحِدَةً، فَيَسْمَعُهَا أَنِيسُ عِنْدَ السُّؤَالِ عَنِ الصَّلَاةِ أَوْ عِنْدَ ضَبْطِ القِبْلَةِ.</p>
      {err && <p className="mb-2 text-xl font-bold text-destructive">{err}</p>}
      <div className="grid gap-2">
        {CLIP_KEYS.map((c) => {
          const has = hydrated && !!getClip(c.key); const active = rec?.key === c.key;
          return (
            <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted p-3">
              <span className="text-xl font-bold">«{c.say}» {has ? "✅" : ""}</span>
              <span className="flex gap-2">
                {active
                  ? <button onClick={stop} className="rounded-xl bg-live px-4 py-2 text-xl font-bold text-live-foreground">⏹ إِنْهَاءٌ</button>
                  : <button disabled={!!rec} onClick={() => start(c.key)} className="rounded-xl bg-primary px-4 py-2 text-xl font-bold text-primary-foreground">⏺ سَجِّلْ</button>}
                {has && !active && <>
                  <button onClick={() => { document.querySelectorAll("audio").forEach((x) => x.pause()); new Audio(getClip(c.key)).play(); }} className="rounded-xl bg-gold px-4 py-2 text-xl font-bold text-gold-foreground">▶</button>
                  <button onClick={() => { removeClip(c.key); force((n) => n + 1); }} className="rounded-xl border-2 border-gold px-3 py-2 text-xl">🗑</button>
                </>}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
