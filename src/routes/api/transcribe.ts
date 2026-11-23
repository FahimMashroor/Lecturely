import { createFileRoute } from "@tanstack/react-router";
import { transcribeAudio, EngineError } from "@/server/engine";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const file = form.get("file");
        const language = String(form.get("language") || "") || undefined;
        const before = String(form.get("prompt") || "");
        const keywords = String(form.get("keywords") || "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 50);
        if (!(file instanceof Blob) || file.size < 1000) return Response.json({ text: "" });
        if (file.size > 20_000_000) return new Response("Too large", { status: 413 });
        // Key terms and the last words heard help the service spell names and terms right.
        const prompt = [keywords.length ? `Terms: ${keywords.join(", ")}.` : "", before].filter(Boolean).join(" ") || undefined;
        try {
          const text = await transcribeAudio({ file, language, prompt });
          return Response.json({ text });
        } catch (e) {
          const status = e instanceof EngineError ? e.httpStatus : 500;
          return Response.json({ error: "Transcription failed" }, { status });
        }
      },
    },
  },
});
