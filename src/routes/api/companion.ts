import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FATWA_REPLY, NOT_FOUND, isFatwa, isMeaningQ } from "@/lib/duas";

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(600) })).min(1).max(20),
});

const SYSTEM = `أنت مساعد مختص فقط بتوضيح معاني الكلمات الغريبة في القرآن الكريم اعتماداً على "التفسير الميسر" (مجمع الملك فهد).
- أجب إجابة مباشرة مقتضبة (جملة واحدة أو اثنتان، أقل من 30 كلمة) عن معنى الكلمة المسؤول عنها فقط، ثم اختم بعبارة: "المصدر: التفسير الميسر".
- خطاب محايد تماماً بلا ألقاب أو نداءات، مناسب للرجال والنساء.
- لا تكتب أدعية ولا أحاديث ولا تفسيراً موسعاً ولا أي رأي أو حكم شرعي أو فتوى.
- إن لم يكن السؤال عن معنى كلمة قرآنية، أو لم تكن متأكداً من معناها في التفسير الميسر، فأجب حرفياً: "${NOT_FOUND}"`;

export const Route = createFileRoute("/api/companion")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "طلب غير صالح" }, { status: 400 });
        const msgs = parsed.data.messages;
        const last = msgs[msgs.length - 1]!;
        if (isFatwa(last.content)) return Response.json({ reply: FATWA_REPLY, fatwa: true });
        if (!isMeaningQ(last.content)) return Response.json({ reply: NOT_FOUND });
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return Response.json({ error: "الخدمة غير مهيأة" }, { status: 500 });
        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
          method: "POST",
          signal: request.signal,
          headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, Authorization: `Bearer ${apiKey}`, "X-Lovable-AIG-SDK": "fetch" },
          body: JSON.stringify({
            model: "openai/gpt-6-astra",
            instructions: SYSTEM,
            input: [{ role: "user", content: last.content }],
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
        if (refused || !text.trim()) return Response.json({ reply: NOT_FOUND });
        return Response.json({ reply: text.replace(/يا\s*حاج(ه|ة)?[،,]?\s*/g, "").trim().slice(0, 290) });
      },
    },
  },
});
