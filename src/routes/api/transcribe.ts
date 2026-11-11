import { createFileRoute } from "@tanstack/react-router";
import { transcribeAudio, GatewayError } from "@lovable.dev/ai-gateway";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const file = form.get("file");
        const language = String(form.get("language") || "") || undefined;
        const prompt = String(form.get("prompt") || "") || undefined;
        const keywords = String(form.get("keywords") || "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 50);
        if (!(file instanceof Blob) || file.size < 1000) return Response.json({ text: "" });
        if (file.size > 20_000_000) return new Response("Too large", { status: 413 });
        try {
          const res = await transcribeAudio({
            model: "openai/gpt-transcribe",
            file,
            ...(language ? { language } : {}),
            ...(prompt ? { prompt } : {}),
            ...(keywords.length ? { keywords } : {}),
            response_format: "json",
            temperature: 0,
          });
          const text = typeof res === "string" ? res : (res as { text?: string }).text ?? "";
          return Response.json({ text });
        } catch (e) {
          const status = e instanceof GatewayError && e.httpStatus ? e.httpStatus : 500;
          return Response.json({ error: "Transcription failed" }, { status });
        }
      },
    },
  },
});
