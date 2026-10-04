// All spoken audio is pre-recorded MP3. Empty URLs are skipped (a soft chime plays instead).
export type Track = { url: string; label: string };

const AR = "https://archive.org/download";
const AF = `${AR}/sheikh-mishary-rashid-alafasy-azkar/${encodeURIComponent("Sheikh Mishary Rashid Alafasy - ")}`;
const SLEEP = `${AR}/Moath_a4_hotmail_20130507/%25D8%25A3%25D8%25B0%25D9%2583%25D8%25A7%25D8%25B1%20%25D8%25A7%25D9%2584%25D9%2586%25D9%2588%25D9%2585%20-%20%25D9%2585%25D8%25B4%25D8%25A7%25D8%25B1%25D9%258A%20%25D8%25A7%25D9%2584%25D9%2585%25D8%25B9%25D9%2581%25D8%25A7%25D8%25B3%25D9%258A.mp3`;
const AZ = (f: string) => `${AR}/azkar-alafasy/${f}.mp3`;

// Complete athkar recordings (supplications) by Sheikh Mishary Alafasy — no plain surahs.
export const ATHKAR: Record<string, { title: string; tracks: Track[] }> = {
  morning: {
    title: "أَذْكَارُ الصَّبَاحِ",
    tracks: [{ url: AF + encodeURIComponent("أذكار الصباح.mp3"), label: "أَذْكَارُ الصَّبَاحِ كَامِلَةً" }],
  },
  evening: {
    title: "أَذْكَارُ المَسَاءِ",
    tracks: [{ url: AF + encodeURIComponent("أذكار المساء.mp3"), label: "أَذْكَارُ المَسَاءِ كَامِلَةً" }],
  },
  sleep: {
    title: "أَذْكَارُ النَّوْمِ",
    tracks: [{ url: SLEEP, label: "أَذْكَارُ النَّوْمِ كَامِلَةً" }],
  },
  wird: {
    title: "الوِرْدُ اليَوْمِيُّ",
    tracks: [
      { url: AF + encodeURIComponent("اذكار الصباح والمساء.mp3"), label: "أَذْكَارُ أَطْرَافِ النَّهَارِ" },
      { url: AZ("azkar-baed-al-salah"), label: "الأَذْكَارُ بَعْدَ الصَّلَاةِ" },
      { url: AZ("azkar-baed-al-salah-2"), label: "الأَذْكَارُ بَعْدَ الصَّلَاةِ (٢)" },
      { url: AZ("sobhan-allah-mla-albr"), label: "سُبْحَانَ اللَّهِ مِلْءَ البَرِّ" },
      { url: AZ("alhamdu-lellah-adad-ma-khalq"), label: "الحَمْدُ لِلَّهِ عَدَدَ مَا خَلَقَ" },
      { url: AZ("allahu-akbaru-kabira"), label: "اللَّهُ أَكْبَرُ كَبِيرًا" },
      { url: AZ("doaa-after-tashahud"), label: "دُعَاءٌ بَعْدَ التَّشَهُّدِ" },
    ],
  },
};

// Sheikh Ibn Uthaymeen — "نور على الدرب" Q&A episodes (archive.org).
const NOOR = (n: number, part: "a" | "b") => `${AR}/253b_20210725/${String(n).padStart(3, "0")}${part}.mp3`;
const AR_NUM = (n: number) => n.toLocaleString("ar-EG");
export const RADIO: { title: string; tracks: Track[] }[] = Array.from({ length: 20 }, (_, i) => ({
  title: `الحَلْقَةُ ${AR_NUM(i + 1)}`,
  tracks: (["a", "b"] as const).map((p, j) => ({ url: NOOR(i + 1, p), label: `نُورٌ عَلَى الدَّرْبِ — الحَلْقَةُ ${AR_NUM(i + 1)} (${j ? "الجُزْءُ الثَّانِي" : "الجُزْءُ الأَوَّلُ"})` })),
}));

export const AZAN_URL = "https://www.islamcan.com/audio/adhan/azan1.mp3";

export const PRAYER_AR: Record<string, string> = {
  Fajr: "الفَجْرُ", Dhuhr: "الظُّهْرُ", Asr: "العَصْرُ", Maghrib: "المَغْرِبُ", Isha: "العِشَاءُ",
};

export const CITIES = [
  { id: "tripoli", ar: "طَرَابُلُس - لِيبْيَا", city: "Tripoli", country: "Libya", lat: 32.8872, lon: 13.1913 },
  { id: "benghazi", ar: "بَنْغَازِي - لِيبْيَا", city: "Benghazi", country: "Libya", lat: 32.1167, lon: 20.0667 },
  { id: "misrata", ar: "مِصْرَاتَة - لِيبْيَا", city: "Misrata", country: "Libya", lat: 32.3754, lon: 15.0925 },
  { id: "zawiya", ar: "الزَّاوِيَة - لِيبْيَا", city: "Zawiya", country: "Libya", lat: 32.7522, lon: 12.7278 },
  { id: "sabha", ar: "سَبْهَا - لِيبْيَا", city: "Sabha", country: "Libya", lat: 27.0377, lon: 14.4283 },
  { id: "bayda", ar: "البَيْضَاء - لِيبْيَا", city: "Bayda", country: "Libya", lat: 32.7627, lon: 21.7551 },
  { id: "tobruk", ar: "طُبْرُق - لِيبْيَا", city: "Tobruk", country: "Libya", lat: 32.0836, lon: 23.9764 },
  { id: "tunis", ar: "تُونِس - تُونِس", city: "Tunis", country: "Tunisia", lat: 36.8065, lon: 10.1815 },
  { id: "cairo", ar: "القَاهِرَة - مِصْر", city: "Cairo", country: "Egypt", lat: 30.0444, lon: 31.2357 },
  { id: "riyadh", ar: "الرِّيَاض - السُّعُودِيَّة", city: "Riyadh", country: "Saudi Arabia", lat: 24.7136, lon: 46.6753 },
];

export function normalizeAr(s: string) {
  return s
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim();
}

export function qiblaBearing(lat: number, lon: number) {
  const r = Math.PI / 180;
  const kLat = 21.4225 * r, kLon = 39.8262 * r;
  const p = lat * r, dl = kLon - lon * r;
  const y = Math.sin(dl);
  const x = Math.cos(p) * Math.tan(kLat) - Math.sin(p) * Math.cos(dl);
  return (Math.atan2(y, x) / r + 360) % 360;
}

export function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25);
      o.stop(ctx.currentTime + i * 0.25 + 0.65);
    });
  } catch { /* ignore */ }
}
