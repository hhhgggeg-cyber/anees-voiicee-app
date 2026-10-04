// All spoken audio is pre-recorded MP3. Empty URLs are skipped (a soft chime plays instead).
const alafasyAyah = (n: number) => `https://cdn.islamic.network/quran/audio/128/ar.alafasy/${n}.mp3`;
const alafasySurah = (n: number) => `https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy/${n}.mp3`;

export type Track = { url: string; label: string };

export const ATHKAR: Record<string, { title: string; tracks: Track[] }> = {
  morning: {
    title: "أَذْكَارُ الصَّبَاحِ",
    tracks: [
      { url: alafasyAyah(262), label: "آيَةُ الكُرْسِيِّ" },
      { url: alafasySurah(112), label: "سُورَةُ الإِخْلَاصِ" },
      { url: alafasySurah(113), label: "سُورَةُ الفَلَقِ" },
      { url: alafasySurah(114), label: "سُورَةُ النَّاسِ" },
    ],
  },
  evening: {
    title: "أَذْكَارُ المَسَاءِ",
    tracks: [
      { url: alafasyAyah(262), label: "آيَةُ الكُرْسِيِّ" },
      { url: alafasyAyah(292), label: "آمَنَ الرَّسُولُ" },
      { url: alafasyAyah(293), label: "لَا يُكَلِّفُ اللَّهُ نَفْسًا" },
      { url: alafasySurah(112), label: "سُورَةُ الإِخْلَاصِ" },
      { url: alafasySurah(113), label: "سُورَةُ الفَلَقِ" },
      { url: alafasySurah(114), label: "سُورَةُ النَّاسِ" },
    ],
  },
  sleep: {
    title: "أَذْكَارُ النَّوْمِ",
    tracks: [
      { url: alafasyAyah(262), label: "آيَةُ الكُرْسِيِّ" },
      { url: alafasyAyah(292), label: "خَوَاتِيمُ البَقَرَةِ" },
      { url: alafasyAyah(293), label: "خَوَاتِيمُ البَقَرَةِ" },
      { url: alafasySurah(67), label: "سُورَةُ المُلْكِ" },
      { url: alafasySurah(112), label: "سُورَةُ الإِخْلَاصِ" },
      { url: alafasySurah(113), label: "سُورَةُ الفَلَقِ" },
      { url: alafasySurah(114), label: "سُورَةُ النَّاسِ" },
    ],
  },
  wird: {
    title: "الوِرْدُ اليَوْمِيُّ",
    tracks: [
      { url: alafasySurah(1), label: "سُورَةُ الفَاتِحَةِ" },
      { url: alafasySurah(36), label: "سُورَةُ يس" },
      { url: alafasySurah(56), label: "سُورَةُ الوَاقِعَةِ" },
    ],
  },
};

// Sheikh Ibn Uthaymeen — paste direct MP3 links here.
export const RADIO: { topic: string; tracks: Track[] }[] = [
  { topic: "أَحْكَامُ الصَّلَاةِ وَطَهَارَتُهَا", tracks: [{ url: "", label: "نُورٌ عَلَى الدَّرْبِ — سُؤَالٌ فِي الطَّهَارَةِ" }] },
  { topic: "أَحْكَامُ الصَّوْمِ وَالزَّكَاةِ", tracks: [{ url: "", label: "نُورٌ عَلَى الدَّرْبِ — سُؤَالٌ فِي الصِّيَامِ" }] },
  { topic: "أَحْكَامُ الحَجِّ وَالعُمْرَةِ", tracks: [{ url: "", label: "نُورٌ عَلَى الدَّرْبِ — سُؤَالٌ فِي المَنَاسِكِ" }] },
  { topic: "فَضْلُ ذِكْرِ اللَّهِ وَالعَمَلِ الصَّالِحِ", tracks: [{ url: "", label: "نُورٌ عَلَى الدَّرْبِ — فَضْلُ الذِّكْرِ" }] },
];

export const AZAN_URL = "https://www.islamcan.com/audio/adhan/azan1.mp3";

// Pre-recorded voice clips for the prayer-time announcement. Paste MP3 links.
export const PRAYER_CLIPS = {
  nextPrayer: "", // "الصَّلَاةُ القَادِمَةُ"
  after: "", // "بَعْدَ"
  hour: "", // "سَاعَة"
  minute: "", // "دَقِيقَة"
  names: { Fajr: "", Dhuhr: "", Asr: "", Maghrib: "", Isha: "" } as Record<string, string>,
  numbers: {} as Record<number, string>, // 0..59 → mp3
};
export const QIBLA_OK_CLIP = ""; // "اتِّجَاهُ القِبْلَةِ صَحِيحٌ"

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
