import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(600) })).min(1).max(20),
});

export const FATWA_REPLY =
  "عذراً، أنا رفيق إيماني ولستُ عالماً للإفتاء. يُرجى استشارة دار الإفتاء أو أهل العلم المختصين. هل تحب تشغيل أذكار الصباح أو القرآن الكريم؟";

const norm = (s: string) =>
  s.replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
// Hard guardrail: any ruling/fatwa question is refused before reaching the model.
const FATWA = ["حكم", "حلال", "حرام", "يجوز", "جايز", "فتوي", "افتني", "مكروه", "واجب", "فرض", "سنه ام", "مباح", "شرعا", "يبطل", "تبطل", "باطل", "زكاه كم", "كفاره", "ينفع اصلي", "هل علي"];
const isFatwa = (t: string) => FATWA.some((w) => norm(t).includes(norm(w)));

const ACTIONS = ["morning", "evening", "sleep", "wird", "fatiha", "none"] as const;
type Action = (typeof ACTIONS)[number];

const SYSTEM = `أنت "أَنِيس الرفيق"، رفيق إيماني لطيف لكبار السن من الرجال والنساء. تكلّم بعربية بسيطة دافئة بخطاب محايد تماماً: لا تستخدم أي لقب أو نداء (لا "يا حاج" ولا "يا حاجة" ولا غيرها)، وتجنّب صيغ التذكير والتأنيث قدر الإمكان.
مهامك فقط:
1) الونس والدعم النفسي بكلام طيب قصير من عندك (بدون أي نص ديني).
2) توضيح معنى كلمة غريبة في القرآن فقط اعتماداً على "التفسير الميسر"، وإن لم تكن متأكداً فقل ذلك بلطف.
ممنوع منعاً باتاً: كتابة أو قراءة أي دعاء أو ذكر أو حديث أو آية بنفسك، أو تأليف أدعية جديدة. بدلاً من ذلك اختر تسجيلاً معتمداً مسجلاً بصوت الشيوخ ليُشغَّل فوراً، وردّك يكون ترحيباً بسيطاً فقط مثل "حاضر، إليك أذكار النوم بصوت الشيخ مشاري العفاسي".
التسجيلات المتاحة (اختر واحداً عند الحاجة):
- morning: أذكار الصباح (العفاسي)
- evening: أذكار المساء (العفاسي)
- sleep: أذكار النوم (العفاسي)
- wird: أذكار أطراف النهار والورد اليومي (العفاسي) — مناسب للضيق والهم والقلق
- fatiha: سورة الفاتحة (الشيخ أحمد العجمي) — مناسب لطلب الشفاء والمرض
- none: لا تشغيل
ممنوع منعاً باتاً: الفتوى أو أحكام الحلال والحرام أو الأسئلة الفقهية أو الرأي الشرعي. إن سُئلت عن حكم فرد حرفياً بهذا النص فقط: "${FATWA_REPLY}" مع none.
لا تتكلم في السياسة أو التشخيص الطبي؛ انصح بمراجعة الطبيب بلطف.
الرد قصير جداً: جملة أو جملتان، أقل من 35 كلمة، نص عادي بلا رموز.
في نهاية ردك اكتب سطراً أخيراً بالضبط بهذا الشكل: [[ACTION:الاسم]]`;

export const Route = createFileRoute("/api/companion")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "طلب غير صالح" }, { status: 400 });
        const msgs = parsed.data.messages;
        const last = msgs[msgs.length - 1]!;
        if (last.role === "user" && isFatwa(last.content)) return Response.json({ reply: FATWA_REPLY, action: "none", fatwa: true });
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return Response.json({ error: "الخدمة غير مهيأة" }, { status: 500 });
        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
          method: "POST",
          signal: request.signal,
          headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, Authorization: `Bearer ${apiKey}`, "X-Lovable-AIG-SDK": "fetch" },
          body: JSON.stringify({
            model: "openai/gpt-6-astra",
            instructions: SYSTEM,
            input: msgs.map((m) => ({ role: m.role, content: m.content })),
            stream: true,
            store: false,
            reasoning: { effort: "low", summary: "auto" },
            include: ["reasoning.encrypted_content"],
          }),
        });
        if (!upstream.ok || !upstream.body) {
          const err = await upstream.text();
          console.error(`Companion failed [${upstream.status}]: ${err}`);
          const msg = upstream.status === 402 ? "نفد رصيد الذكاء الاصطناعي" : upstream.status === 429 ? "الضغط كبير، حاول بعد قليل" : "تعذّر الرد الآن";
          return Response.json({ error: msg }, { status: upstream.status });
        }
        // Consume the stream server-side; voice playback needs the full sentence.
        const reader = upstream.body.getReader();
        const dec = new TextDecoder();
        let buf = "", text = "", refused = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const frames = buf.split("\n\n"); buf = frames.pop() ?? "";
          for (const f of frames) {
            const line = f.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const ev = JSON.parse(data);
              if (ev.type === "response.output_text.delta") text += ev.delta;
              if (ev.type === "response.refusal.delta") refused = true;
            } catch { /* partial */ }
          }
        }
        if (refused || !text.trim()) return Response.json({ reply: FATWA_REPLY, action: "none" });
        const m = text.match(/\[\[ACTION:\s*(\w+)\s*\]\]/);
        const action: Action = m && (ACTIONS as readonly string[]).includes(m[1]!) ? (m[1] as Action) : "none";
        const reply = text.replace(/\[\[ACTION:[^\]]*\]\]/g, "").replace(/يا\s*حاج(ه|ة)?/g, "").trim().slice(0, 290);
        return Response.json({ reply, action });
      },
    },
  },
});
