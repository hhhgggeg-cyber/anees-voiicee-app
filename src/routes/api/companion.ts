import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(600) })).min(1).max(20),
});

export const FATWA_REPLY =
  "عذراً يا حاج، أنا رفيق إيماني ولستُ عالماً للإفتاء. يُرجى استشارة دار الإفتاء أو أهل العلم المختصين. هل تحب أن أقرأ عليك أذكار الصباح أو تشغيل القرآن؟";

const norm = (s: string) =>
  s.replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
// Hard guardrail: any ruling/fatwa question is refused before reaching the model.
const FATWA = ["حكم", "حلال", "حرام", "يجوز", "جايز", "فتوي", "افتني", "مكروه", "واجب", "فرض", "سنه ام", "مباح", "شرعا", "يبطل", "تبطل", "باطل", "زكاه كم", "كفاره", "ينفع اصلي", "هل علي"];
const isFatwa = (t: string) => FATWA.some((w) => norm(t).includes(norm(w)));

const SYSTEM = `أنت "أَنِيس الرفيق"، رفيق إيماني لطيف لكبار السن. تكلّم بالعربية البسيطة القريبة من القلب، وخاطب المستخدم بـ"يا حاج".
مهامك فقط:
1) الونس والدعم النفسي والإيماني بكلام طيب قصير.
2) اقتراح أدعية وأذكار مأثورة صحيحة ثابتة (مثل دعاء الشفاء: "اللهم رب الناس أذهب البأس اشفِ أنت الشافي"، دعاء الكرب: "لا إله إلا أنت سبحانك إني كنت من الظالمين"، أذكار النوم)، والتذكير بها حسب حال المستخدم. لا تخترع أدعية.
3) توضيح معنى كلمة غريبة في القرآن فقط اعتماداً على "التفسير الميسر" (مجمع الملك فهد)، وإن لم تكن متأكداً فقل ذلك بلطف.
ممنوع منعاً باتاً: الفتوى، أو أحكام الحلال والحرام، أو الأسئلة الفقهية، أو الرأي الشرعي، أو تفسير الآيات بأكثر من معنى الكلمة. إن سُئلت عن أي حكم فرد حرفياً بهذا النص فقط: "${FATWA_REPLY}"
لا تتكلم في السياسة أو الطب التشخيصي؛ انصح بمراجعة الطبيب بلطف.
الرد قصير جداً: جملتان إلى ثلاث، أقل من 45 كلمة، نص عادي بلا رموز أو تنسيق، لأنه سيُقرأ بالصوت.`;

export const Route = createFileRoute("/api/companion")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "طلب غير صالح" }, { status: 400 });
        const msgs = parsed.data.messages;
        const last = msgs[msgs.length - 1]!;
        if (last.role === "user" && isFatwa(last.content)) return Response.json({ reply: FATWA_REPLY, fatwa: true });
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
        if (refused || !text.trim()) return Response.json({ reply: FATWA_REPLY });
        return Response.json({ reply: text.trim().slice(0, 290) });
      },
    },
  },
});
