import { createFileRoute } from "@tanstack/react-router";
import { buildPrompt, parseLesson } from "@/lib/prompts";
import { generateText, generateImage, EngineError } from "@/server/engine";

export const Route = createFileRoute("/api/study")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { mode, text, langName, terms } = (await request.json()) as { mode: string; text: string; langName?: string; terms?: string };
        if (!text?.trim()) return Response.json({ error: "No transcript" }, { status: 400 });
        const clipped = text.slice(0, 200_000);
        try {
          if (mode === "visual") {
            const brief = await generateText(
              `Describe, in under 80 words, one clear educational diagram that best explains the central idea of this lecture. Labels must be short English words. Output only the description.\n\n${clipped}`,
            );
            const b64 = await generateImage(`Clean, minimal educational diagram on a white background, textbook style, legible short labels. ${brief}`);
            if (!b64) throw new Error("no image");
            return Response.json({ image: `data:image/png;base64,${b64}`, caption: brief });
          }
          const prompt = buildPrompt(mode, clipped, langName, terms);
          if (!prompt) return Response.json({ error: "Unknown mode" }, { status: 400 });
          const out = await generateText(prompt);
          if (mode === "lesson") {
            const json = parseLesson(out);
            return Response.json({ lesson: json });
          }
          return Response.json({ text: out });
        } catch (e) {
          const status = e instanceof EngineError ? e.httpStatus : 500;
          return Response.json({ error: "Failed" }, { status });
        }
      },
    },
  },
});
