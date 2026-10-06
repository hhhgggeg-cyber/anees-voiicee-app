import { DUAS, findDua, isFatwa, isMeaningQ } from "@/lib/duas";
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

type View = "home" | "quran" | "athkar" | "radio" | "prayer" | "qibla" | "companion";
type ChatMsg = { role: "user" | "assistant"; content: string };
type Ayah = { text: string; audio: string; numberInSurah: number };
type SurahMeta = { number: number; name: string };
const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

// Clock & date formatters (device's own timezone)
const fmtTime = new Intl.DateTimeFormat("ar", { hour: "numeric", minute: "2-digit", hour12: true });
const fmtHijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtGreg = new Intl.DateTimeFormat("ar-u-ca-gregory", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const clockStrings = (d: Date) => ({
  time: fmtTime.format(d),
  hijri: fmtHijri.format(d),
  greg: fmtGreg.format(d),
});

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

  const [cityId, setCityId] = useState("");
  const city = CITIES.find((c) => c.id === cityId) ?? null;
  const [geoError, setGeoError] = useState("");
  const [tz, setTz] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
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
    a.src = t.url;
    const saved = t.url.includes("253b_") ? Number(localStorage.getItem("anees-pos-" + t.url) || 0) : 0;
    if (saved > 5) a.addEventListener("loadedmetadata", () => { try { a.currentTime = saved; } catch { /* */ } }, { once: true });
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
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
      const eu = queueRef.current[idxRef.current]?.url; if (eu?.includes("253b_")) localStorage.removeItem("anees-pos-" + eu);
      if (repeatRef.current) { a.currentTime = 0; a.play(); return; }
      const n = idxRef.current + 1;
      if (n < queueRef.current.length) playAt(n);
      else { setPlaying(false); startListening(); }
    };
    let lastSave = 0;
    a.ontimeupdate = () => {
      const u = a.currentSrc || a.src;
      if (!u.includes("253b_") || Date.now() - lastSave < 3000) return;
      lastSave = Date.now();
      const key = "anees-pos-" + (queueRef.current[idxRef.current]?.url ?? u);
      if (a.duration && a.currentTime > a.duration - 10) localStorage.removeItem(key); else localStorage.setItem(key, String(Math.floor(a.currentTime)));
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

  const preloaded = useRef<HTMLAudioElement[]>([]);
  const openAthkar = (k: string) => {
    vibrate(); setView("athkar"); setAthkarKey(k);
    if (!preloaded.current.length) preloaded.current = Object.values(ATHKAR).flatMap((c) => c.tracks).map((t) => { const x = new Audio(); x.preload = "auto"; x.src = t.url; return x; });
    startLoading("جَارٍ التَّحْضِيرُ... لَحْظَةً مِنْ فَضْلِكَ");
    const a = audioRef.current;
    a?.addEventListener("playing", () => setLoading(""), { once: true });
    setTimeout(() => setLoading((l) => (l.startsWith("جَارٍ التَّحْضِيرُ") ? "" : l)), 20000);
    playQueue(ATHKAR[k]!.tracks);
  };
  const [lesson, setLesson] = useState(0);
  const playLesson = (i: number) => {
    const n = ((i % RADIO.length) + RADIO.length) % RADIO.length;
    setView("radio"); setLesson(n); playQueue(RADIO[n]!.tracks);
  };
  const openRadio = () => playLesson(lesson);

  const nextPrayer = useCallback(() => {
    if (!timings) return null;
    // "now" expressed as wall-clock time in the location's own timezone
    const now = tz ? new Date(new Date().toLocaleString("en-US", { timeZone: tz })) : new Date();
    for (const p of [...PRAYERS, "Fajr+"]) {
      const key = p.replace("+", "");
      const [h, m] = timings[key]!.split(":").map(Number) as [number, number];
      const d = new Date(now); d.setHours(h, m, 0, 0);
      if (p === "Fajr+") d.setDate(d.getDate() + 1);
      if (d > now) { const secs = Math.floor((d.getTime() - now.getTime()) / 1000); const mins = Math.ceil(secs / 60); return { key, h: Math.floor(mins / 60), m: mins % 60, s: secs % 60, secs }; }
    }
    return null;
  }, [timings, tz]);

  const locate = (force = false) => {
    if (geoTried.current && !force) return;
    geoTried.current = true;
    if (!navigator.geolocation) { setGeoError("جِهَازُكَ لَا يَدْعَمُ تَحْدِيدَ المَوْقِعِ. اخْتَرْ مَدِينَتَكَ يَدَوِيًّا."); return; }
    setGeoError(""); startLoading("جَارٍ تَحْدِيدُ مَوْقِعِكَ...");
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }); setCityId(""); setLoading(""); },
      (e) => {
        setLoading(""); chime(1);
        setGeoError(e.code === 1
          ? "تَمَّ رَفْضُ إِذْنِ المَوْقِعِ. نَحْتَاجُ مَوْقِعَكَ لِحِسَابِ مَوَاقِيتِ الصَّلَاةِ بِدِقَّةٍ. فَعِّلِ الإِذْنَ ثُمَّ أَعِدِ المُحَاوَلَةَ، أَوِ اخْتَرْ مَدِينَتَكَ."
          : "تَعَذَّرَ تَحْدِيدُ مَوْقِعِكَ. أَعِدِ المُحَاوَلَةَ أَوِ اخْتَرْ مَدِينَتَكَ يَدَوِيًّا.");
      },
      { timeout: 15000, enableHighAccuracy: true, maximumAge: 300000 },
    );
  };
  const playPrayerClip = (key: string) => {
    const clip = getClip(key);
    if (clip) playQueue([{ url: clip, label: PRAYER_AR[key] ?? "" }]); else chime(PRAYERS.indexOf(key) + 1);
  };
  const pendingAnnounce = useRef(false);
  const speak = useCallback(async (text: string, label: string) => {
    stopListening(); audioRef.current?.pause();
    startLoading("جَارٍ تَجْهِيزُ الرَّدِّ الصَّوْتِيِّ...");
    try {
      const r = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!r.ok) throw new Error(await r.text());
      const url = URL.createObjectURL(await r.blob());
      setLoading(""); playQueue([{ url, label }]);
    } catch {
      setLoading(""); chime(1); setNotice(label); listenLater(1500);
    }
  }, [playQueue, listenLater]);

  // ---------- companion ----------
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const chatRef = useRef<ChatMsg[]>([]);
  const askCompanion = useCallback(async (text: string) => {
    setView("companion");
    const msgs = [...chatRef.current, { role: "user" as const, content: text.slice(0, 600) }].slice(-12);
    chatRef.current = msgs; setChat(msgs);
    const add = (content: string) => { chatRef.current = [...chatRef.current, { role: "assistant", content }]; setChat(chatRef.current); };
    // Supplications & hadiths: only from the fixed verified list, shown as text with source (never AI-generated or AI-voiced).
    const dua = !isFatwa(text) && !isMeaningQ(text) ? findDua(text) : null;
    if (dua) { vibrate(); chime(1); add(`${dua.title}:\n${dua.text}\nالمصدر: ${dua.source}`); listenLater(4000); return; }
    startLoading("جَارٍ البَحْثُ...");
    try {
      const r = await fetch("/api/companion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [msgs[msgs.length - 1]] }) });
      const d = await r.json() as { reply?: string; error?: string };
      if (!d.reply) throw new Error(d.error ?? "");
      add(d.reply); setLoading(""); speak(d.reply, d.reply);
    } catch (e) {
      setLoading(""); chime(1); setNotice((e as Error).message || "تعذّر الرد الآن، حاول مرة أخرى"); listenLater(1500);
    }
  }, [speak, listenLater]);
  const openCompanion = () => {
    setView("companion");
    if (!chatRef.current.length) {
      const hi = "أهلاً وسهلاً. اسأل عن دعاء مثل الشفاء أو تفريج الهم أو السفر، أو عن معنى كلمة في القرآن.";
      chatRef.current = [{ role: "assistant", content: hi }]; setChat(chatRef.current); speak(hi, hi);
    } else startListening();
  };

  const announcePrayer = useCallback(() => {
    const np = nextPrayer(); if (!np) return;
    const name = PRAYER_AR[np.key] ?? "";
    const hrs = np.h === 0 ? "" : np.h === 1 ? "ساعة" : np.h === 2 ? "ساعتان" : np.h <= 10 ? `${np.h} ساعات` : `${np.h} ساعة`;
    const mins = np.m === 0 ? "" : np.m === 1 ? "دقيقة واحدة" : np.m === 2 ? "دقيقتان" : np.m <= 10 ? `${np.m} دقائق` : `${np.m} دقيقة`;
    const rest = [hrs, mins].filter(Boolean).join(" و") || "أقل من دقيقة";
    const text = `الصلاة القادمة هي صلاة ${name.replace(/^ال/, "")}، الباقي ${rest}.`;
    speak(text, text);
  }, [nextPrayer, speak]);

  useEffect(() => { if (timings && pendingAnnounce.current) { pendingAnnounce.current = false; announcePrayer(); } }, [timings, announcePrayer]);
  const openPrayer = () => { setView("prayer"); locate(); if (timings) announcePrayer(); else pendingAnnounce.current = true; };

  useEffect(() => {
    setTimings(null); setTz(null);
    if (!coords && !city) return;
    startLoading("جَارٍ تَحْمِيلُ مَوَاقِيتِ الصَّلَاةِ...");
    const ts = Math.floor(Date.now() / 1000);
    const url = coords
      ? `https://api.aladhan.com/v1/timings/${ts}?latitude=${coords.lat}&longitude=${coords.lon}&method=3`
      : `https://api.aladhan.com/v1/timingsByCity/${ts}?city=${city!.city}&country=${city!.country}&method=3`;
    fetch(url).then((r) => r.json()).then((d) => { setTz(d.data.meta?.timezone ?? null); setTimings(d.data.timings); })
      .catch(() => setGeoError("تَعَذَّرَ تَحْمِيلُ المَوَاقِيتِ. تَحَقَّقْ مِنَ الإِنْتَرْنِتِ وَأَعِدِ المُحَاوَلَةَ."))
      .finally(() => setLoading(""));
  }, [city?.city, city?.country, coords]);

  // Azan alert
  useEffect(() => {
    if (!timings) return;
    let last = "";
    const t = setInterval(() => {
      const now = tz ? new Date(new Date().toLocaleString("en-US", { timeZone: tz })) : new Date(); const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const p = PRAYERS.find((k) => timings[k] === hm);
      if (p && last !== hm) { last = hm; setAzanAlert(PRAYER_AR[p] ?? ""); playQueue([{ url: AZAN_URL, label: `أذان ${PRAYER_AR[p]}` }]); }
    }, 1000);
    return () => clearInterval(t);
  }, [timings, tz, playQueue]);

  // Qibla
  const qibla = coords ? qiblaBearing(coords.lat, coords.lon) : city ? qiblaBearing(city.lat, city.lon) : 0;
  const openQibla = async () => {
    setView("qibla"); qiblaOkRef.current = false;
    if (!coords && !city) { locate(); setNotice("نَحْتَاجُ مَوْقِعَكَ لِتَحْدِيدِ القِبْلَةِ. اسْمَحْ بِالمَوْقِعِ أَوِ اخْتَرْ مَدِينَتَكَ مِنْ شَاشَةِ المَوَاقِيتِ."); chime(1); return; }
    const dirs = ["الشمال", "الشمال الشرقي", "الشرق", "الجنوب الشرقي", "الجنوب", "الجنوب الغربي", "الغرب", "الشمال الغربي"];
    const dir = dirs[Math.round(qibla / 45) % 8];
    const text = `القبلة باتجاه ${dir}، على زاوية ${Math.round(qibla)} درجة من الشمال. أدر الهاتف ببطء حتى تسمع التأكيد.`;
    speak(text, `القبلة باتجاه ${dir}`);
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
    if (has("تكرار", "كرر", "اعاده", "عاود", "عاودها", "اعد", "اعيد", "مره ثانيه", "مره تانيه", "كمان مره", "زيدها")) {
      const a = audioRef.current; vibrate(80);
      if (a && a.src) { a.currentTime = 0; a.play().catch(() => {}); } else toggleRepeat();
      return;
    }
    if (has("توقف", "اسكت", "قف")) { stopAudio(); return; }
    if (has("الرئيسيه", "رجوع")) { stopAudio(); setView("home"); return; }
    // Surah by name anywhere in a natural sentence ("افتحلي سورة الملك", "ابي اسمع يس")
    const strip = (x: string) => normalizeAr(x).replace(/^سوره\s*/, "").replace(/^ال/, "");
    const words = t.split(/\s+/).map((w) => w.replace(/^(و|ف)?ال/, ""));
    const named = surahs.find((x) => { const n = strip(x.name); return n.length >= 2 && (has("سوره") ? words.includes(n) || t.includes("سوره " + normalizeAr(x.name).replace(/^سوره\s*/, "")) : n.length >= 2 && words.includes(n)); });
    if (named && !has("اذكار", "ذكر")) { openSurah(named.number); return; }
    if (has("رفيق", "ونسني", "سولف", "احكي معي", "تكلم معي", "كلمني", "دردش")) { if (view !== "companion") openCompanion(); return; }
    const wantsNav = has("سوره", "اذكار", "ذكر", "مواقيت", "اذان", "قبله", "قران", "درس", "حلقه", "شغل", "افتح", "سمعني", "قريلي");
    if (view === "companion" && !wantsNav) { askCompanion(raw); return; }
    if (has("ضايق", "ضيق", "تعبان", "مريض", "حزين", "وحيد", "خايف", "زعلان", "مهموم")) { askCompanion(raw); return; }
    if (has("درس", "حلقه", "محاضره") || view === "radio") {
      if (has("تالي", "بعده", "التاليه", "اللي بعد")) return playLesson(lesson + 1);
      if (has("سابق", "اللي قبل", "السابقه")) return playLesson(lesson - 1);
      if (has("اخر", "غيره", "ثاني غير")) { let r = lesson; while (RADIO.length > 1 && r === lesson) r = Math.floor(Math.random() * RADIO.length); return playLesson(r); }
      const num = lessonNumber(t);
      if (num && num <= RADIO.length) return playLesson(num - 1);
      if (num) { chime(); setNotice(`الدروس المتاحة من ١ إلى ${RADIO.length.toLocaleString("ar-EG")}`); listenLater(1500); return; }
    }
    if (has("قبله", "كعبه", "اتجاه")) { openQibla(); return; }
    if (has("مواقيت", "صلاه", "اذان", "وقت", "باقي", "متي", "مزال", "مازال", "الجايه", "فجر", "ظهر", "عصر", "مغرب", "عشاء")) { openPrayer(); return; }
    if (has("صباح", "الصبح")) return openAthkar("morning");
    if (has("مساء")) return openAthkar("evening");
    if (has("نوم", "انام", "النوم")) return openAthkar("sleep");
    if (has("ورد", "اطراف")) return openAthkar("wird");
    if (has("اذكار", "ذكر", "اذكر")) return openAthkar("morning");
    if (has("محاضر", "درس", "دروس", "حلقه", "راديو", "فتوى", "فتاوي", "فتاوى", "موعظه", "مواعظ", "عثيمين", "شيخ")) return openRadio();
    if (has("سوره")) {
      const q = t.replace(/.*سوره\s*/, "").replace(/^ال/, "").trim();
      const s = surahs.find((x) => { const n = normalizeAr(x.name).replace(/^سوره\s*/, "").replace(/^ال/, ""); return q && (n.startsWith(q) || q.startsWith(n)); });
      openSurah(s ? s.number : 1); return;
    }
    if (has("قران", "قرءان", "سوره", "مصحف", "تلاوه")) { openSurah(1); return; }
    askCompanion(raw);
  };

  const np = nextPrayer();
  const hydrated = useHydrated();
  const clock = hydrated ? clockStrings(new Date()) : null;

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

      {view === "home" && (
        <section aria-label="الساعة والتاريخ" className="rounded-3xl border-4 border-gold bg-secondary px-4 py-4 text-center shadow-xl">
          <p className="text-4xl font-bold tracking-wide text-gold">{clock?.time ?? "…"}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{clock?.hijri ?? " "}</p>
          <p className="mt-1 text-xl font-bold text-foreground/90">{clock?.greg ?? " "}</p>
        </section>
      )}

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
          <Card title="مَوَاقِيتُ الصَّلَاةِ وَالقِبْلَةِ" sub={coords ? "📍 مَوْقِعُكَ الحَالِيُّ" : city?.ar ?? "حَسَبَ مَوْقِعِكَ"} icon="🕌" onClick={openPrayer} />
          <Card title="رَفِيقُ أَنِيس" sub="أَدْعِيَةٌ، وَمَعَانِي كَلِمَاتِ القُرْآنِ، أَحَادِيثٌ" icon="🤲" onClick={openCompanion} />
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

      {view === "companion" && (
        <section className="rounded-3xl border-4 border-gold bg-card p-6 text-card-foreground shadow-xl">
          <h2 className="text-3xl font-bold">🤲 رَفِيقُ أَنِيس</h2>
          <p className="mb-4 text-xl text-muted-foreground">أَدْعِيَةٌ، وَمَعَانِي كَلِمَاتِ القُرْآنِ، أَحَادِيثٌ — قُلْ مَثَلاً: «دُعَاءُ الشِّفَاءِ» أَوْ «مَا مَعْنَى الصَّمَدِ»</p>
          <div className="grid gap-3">
            {chat.map((m, i) => (
              <p key={i} className={`rounded-2xl p-4 whitespace-pre-line text-2xl leading-relaxed ${m.role === "assistant" ? "border-2 border-gold bg-muted" : "bg-primary text-primary-foreground"}`}>
                {m.role === "assistant" ? "أَنِيس: " : "أَنْتَ: "}{m.content}
              </p>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {DUAS.slice(0, 8).map((d) => <BigBtn key={d.id} onClick={() => askCompanion(d.keys[0]!)}>{d.title}</BigBtn>)}
          </div>
          <p className="mt-4 text-center text-lg text-muted-foreground">أَنِيس رَفِيقٌ إِيمَانِيٌّ وَلَا يُفْتِي — لِلْفَتْوَى يُرْجَى سُؤَالُ أَهْلِ العِلْمِ</p>
        </section>
      )}

      {view === "radio" && (
        <section className="rounded-3xl border-4 border-gold bg-card p-6 text-card-foreground">
          <h2 className="text-3xl font-bold">📻 رَادْيُو الدُّرُوسِ وَالمَوَاعِظِ — نُورٌ عَلَى الدَّرْبِ</h2>
          <p className="mb-4 text-xl text-muted-foreground">الشَّيْخُ مُحَمَّدُ بْنُ صَالِحٍ ابْنُ عُثَيْمِين</p>
          <div className="mb-4 flex gap-3">
            <BigBtn onClick={() => (playing ? stopAudio() : openRadio())}>{playing ? "⏸ إِيقَافٌ" : "▶ تَشْغِيلُ الدَّرْسِ"}</BigBtn>
          </div>
          <p className="mb-3 text-center text-3xl font-bold">{RADIO[lesson]!.title}</p>
          <div className="mb-6 grid grid-cols-2 gap-4">
            <button onClick={() => playLesson(lesson - 1)} className="min-h-20 rounded-2xl border-4 border-gold bg-primary text-3xl font-bold text-primary-foreground">السَّابِقُ ▶</button>
            <button onClick={() => playLesson(lesson + 1)} className="min-h-20 rounded-2xl border-4 border-gold bg-primary text-3xl font-bold text-primary-foreground">التَّالِي ◀</button>
          </div>
          <p className="mb-4 text-center text-lg text-muted-foreground">قُلْ: «الدَّرْسُ التَّالِي» أَوْ «الدَّرْسُ السَّابِقُ» أَوْ «الحَلْقَةُ ٧» — وَيُكْمِلُ مِنْ حَيْثُ تَوَقَّفْتَ</p>
          <div className="grid gap-3">
            {RADIO.map((r) => (
              <button key={r.title} onClick={() => playLesson(RADIO.indexOf(r))} className={`rounded-2xl p-4 text-right ${RADIO.indexOf(r) === lesson ? "border-4 border-gold bg-muted" : "bg-muted"}`}>
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
            {geoError && (
              <div role="alert" aria-live="assertive" className="mb-4 rounded-2xl border-4 border-live bg-muted p-5 text-2xl font-bold leading-relaxed">
                ⚠️ {geoError}
              </div>
            )}
            <select value={cityId} onChange={(e) => { setCityId(e.target.value); if (e.target.value) { setCoords(null); setGeoError(""); } }} className="mb-4 w-full rounded-2xl border-4 border-gold bg-card px-4 py-3 text-2xl">
              <option value="">— اخْتَرْ مَدِينَتَكَ يَدَوِيًّا —</option>
              {CITIES.map((c) => <option key={c.id} value={c.id}>{c.ar}</option>)}
            </select>
            <BigBtn onClick={() => { geoTried.current = false; locate(true); }}>📍 {geoError ? "أَعِدِ المُحَاوَلَةَ — " : ""}اسْتَخْدِمْ مَوْقِعِي الحَالِيَّ {coords ? "✅" : ""}</BigBtn>
            {np && (
              <p className="my-4 text-center text-3xl font-bold text-primary">
                الصَّلَاةُ القَادِمَةُ: {PRAYER_AR[np.key]} بَعْدَ <span dir="ltr" className="tabular-nums">{String(Math.floor(np.secs / 3600)).padStart(2, "0")}:{String(Math.floor((np.secs % 3600) / 60)).padStart(2, "0")}:{String(np.secs % 60).padStart(2, "0")}</span>
              </p>
            )}
            <div className="grid gap-2">
              {timings ? ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"].map((p) => (
                <button key={p} onClick={() => (p === "Sunrise" ? chime(1) : playPrayerClip(p))} className={`flex min-h-20 justify-between rounded-2xl p-5 text-right text-3xl font-bold ${np?.key === p ? "bg-gold text-gold-foreground" : "bg-muted"}`}>
                  <span>{p === "Sunrise" ? "الشُّرُوقُ" : PRAYER_AR[p]}</span><span>{fmt12(timings[p] ?? "")}</span>
                </button>
              )) : (coords || city) ? <Spinner label="جَارٍ تَحْمِيلُ المَوَاقِيتِ..." /> : <p className="text-center text-2xl">اسْمَحْ بِتَحْدِيدِ مَوْقِعِكَ أَوِ اخْتَرْ مَدِينَتَكَ لِعَرْضِ المَوَاقِيتِ.</p>}
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
          <p className="text-2xl">القِبْلَةُ: {Math.round(qibla)}° — {coords ? "مَوْقِعُكَ الحَالِيُّ" : city?.ar ?? "حَدِّدْ مَوْقِعَكَ أَوَّلًا"}</p>
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
        {view === "companion" && "مَعَانِي الكَلِمَاتِ: التَّفْسِيرُ المُيَسَّرُ — مُجَمَّعُ المَلِكِ فَهْدٍ • الأَدْعِيَةُ وَالأَحَادِيثُ: حِصْنُ المُسْلِمِ وَالصَّحِيحَانِ"}
        {view === "radio" && "المَصْدَرُ: فَتَاوَى نُورٌ عَلَى الدَّرْبِ — المَكْتَبَةُ الصَّوْتِيَّةُ لِلشَّيْخِ ابْنِ عُثَيْمِين (Archive.org)"}
        {(view === "prayer" || view === "qibla") && "المَصْدَرُ: مَوَاقِيتُ AlAdhan.com — طَرِيقَةُ رَابِطَةِ العَالَمِ الإِسْلَامِيِّ — الأَذَانُ: IslamCan"}
        {view === "home" && "القُرْآنُ: الشَّيْخُ العَجَمِي • الأَذْكَارُ: الشَّيْخُ العَفَاسِي • الدُّرُوسُ: الشَّيْخُ ابْنُ عُثَيْمِين • المَوَاقِيتُ: AlAdhan"}
      </footer>
    </main>
  );
}

const NUM_WORDS: [string[], number][] = [
  [["عشرين", "عشرون"], 20],
  [["تاسع عشر", "تسعه عشر", "تسعة عشر"], 19], [["ثامن عشر", "ثمانيه عشر"], 18], [["سابع عشر", "سبعه عشر"], 17],
  [["سادس عشر", "سته عشر", "ستة عشر"], 16], [["خامس عشر", "خمسه عشر"], 15], [["رابع عشر", "اربعه عشر"], 14],
  [["ثالث عشر", "ثلاثه عشر", "ثلاث عشر"], 13], [["ثاني عشر", "اثني عشر", "اثنا عشر", "اطنعش"], 12], [["حادي عشر", "احد عشر", "احدعش"], 11],
  [["عاشر", "عشره", "عشر"], 10], [["تاسع", "تسعه", "تسع"], 9], [["ثامن", "ثمانيه", "ثمان"], 8], [["سابع", "سبعه", "سبع"], 7],
  [["سادس", "سته", "ست"], 6], [["خامس", "خمسه", "خمس"], 5], [["رابع", "اربعه", "اربع"], 4], [["ثالث", "ثلاثه", "ثلاث"], 3],
  [["ثاني", "اثنين", "اثنان"], 2], [["اول", "واحد"], 1],
];
function lessonNumber(t: string): number | null {
  const d = t.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).match(/\d+/);
  if (d) return Number(d[0]) || null;
  const words = t.split(/\s+/).map((w) => w.replace(/^(و|ف)?ال/, "")).join(" ");
  for (const [forms, n] of NUM_WORDS) if (forms.some((f) => new RegExp(`(^|\\s)${f}(\\s|$)`).test(words))) return n;
  return null;
}

function vibrate(ms = 40) { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } }

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
