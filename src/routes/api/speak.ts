import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ text: z.string().min(1).max(300) });

// Spoken replies for prayer times & Qibla only (Arabic TTS via Lovable AI Gateway).
export const Route = createFileRoute("/api/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Invalid text", { status: 400 });
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Speech not configured", { status: 500 });
        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3.1-flash-tts-preview",
            contents: [{ role: "user", parts: [{ text: `اقرأ بالعربية الفصحى بصوت هادئ وواضح وبطيء: ${parsed.data.text}` }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
            },
            stream_format: "audio",
          }),
        });
        if (!upstream.ok) {
          const err = await upstream.text();
          console.error(`Speech failed [${upstream.status}]: ${err}`);
          return new Response(err, { status: upstream.status });
        }
        return new Response(upstream.body, {
          status: 200,
          headers: { "Content-Type": upstream.headers.get("content-type") ?? "audio/wav", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});
