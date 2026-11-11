import { createFileRoute } from "@tanstack/react-router";
import { buildPrompt, parseLesson } from "@/lib/prompts";
import { generateResponse, generateImage, GatewayError } from "@lovable.dev/ai-gateway";

function textOf(res: unknown): string {
  const r = res as { output?: { type: string; content?: { type: string; text?: string }[] }[] };
  return (r.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .map((c) => (c.type === "output_text" ? c.text ?? "" : ""))
    .join("")
    .trim();
}

export const Route = createFileRoute("/api/study")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { mode, text, langName, terms } = (await request.json()) as { mode: string; text: string; langName?: string; terms?: string };
        if (!text?.trim()) return Response.json({ error: "No transcript" }, { status: 400 });
        const clipped = text.slice(0, 200_000);
        try {
          if (mode === "visual") {
            const brief = textOf(
              await generateResponse({
                model: "openai/gpt-6-astra",
                input: `Describe, in under 80 words, one clear educational diagram that best explains the central idea of this lecture. Labels must be short English words. Output only the description.\n\n${clipped}`,
              }),
            );
            const img = await generateImage({
              model: "openai/gpt-image-2.5-sunburst",
              prompt: `Clean, minimal educational diagram on a white background, textbook style, legible short labels. ${brief}`,
              size: "1536x1024",
              quality: "medium",
            });
            const b64 = img.data?.[0]?.b64_json;
            if (!b64) throw new Error("no image");
            return Response.json({ image: `data:image/png;base64,${b64}`, caption: brief });
          }
          const prompt = buildPrompt(mode, clipped, langName, terms);
          if (!prompt) return Response.json({ error: "Unknown mode" }, { status: 400 });
          const out = textOf(await generateResponse({ model: "openai/gpt-6-astra", input: prompt }));
          if (mode === "lesson") {
            const json = parseLesson(out);
            return Response.json({ lesson: json });
          }
          return Response.json({ text: out });
        } catch (e) {
          const status = e instanceof GatewayError && e.httpStatus ? e.httpStatus : 500;
          return Response.json({ error: "Failed" }, { status });
        }
      },
    },
  },
});
