// Human-recorded voice clips (recorded once by a family member, stored on this device).
export const CLIP_KEYS = [
  { key: "Fajr", say: "الصَّلَاةُ القَادِمَةُ: صَلَاةُ الفَجْرِ" },
  { key: "Dhuhr", say: "الصَّلَاةُ القَادِمَةُ: صَلَاةُ الظُّهْرِ" },
  { key: "Asr", say: "الصَّلَاةُ القَادِمَةُ: صَلَاةُ العَصْرِ" },
  { key: "Maghrib", say: "الصَّلَاةُ القَادِمَةُ: صَلَاةُ المَغْرِبِ" },
  { key: "Isha", say: "الصَّلَاةُ القَادِمَةُ: صَلَاةُ العِشَاءِ" },
  { key: "qiblaGuide", say: "أَدِرِ الهَاتِفَ بِبُطْءٍ حَتَّى تَسْمَعَ التَّأْكِيدَ" },
  { key: "qibla", say: "اتِّجَاهُ القِبْلَةِ صَحِيحٌ" },
] as const;

const k = (key: string) => `anees-clip-${key}`;
export const getClip = (key: string) => (typeof window === "undefined" ? "" : localStorage.getItem(k(key)) ?? "");
export const saveClip = (key: string, dataUrl: string) => localStorage.setItem(k(key), dataUrl);
export const removeClip = (key: string) => localStorage.removeItem(k(key));

export async function recordClip(): Promise<{ stop: () => Promise<string> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.readAsDataURL(new Blob(chunks, { type: rec.mimeType }));
        };
        rec.stop();
      }),
  };
}
