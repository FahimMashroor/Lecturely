// Talks to the online transcription and writing service for the website.
//
// The website's own server keeps the service's secret key, so visitors never see it.
// Set these on the computer that runs the website:
//   ENGINE_API_KEY   the secret key from the service (required for online features)
//   ENGINE_API_URL   the service's address (default: https://api.openai.com/v1)
//   ENGINE_SPEECH_MODEL / ENGINE_TEXT_MODEL / ENGINE_IMAGE_MODEL   optional model names
// Without a key, the website still works with the on-device packs.

export class EngineError extends Error {
  constructor(public httpStatus: number) { super(`engine ${httpStatus}`); }
}

const url = () => (process.env["ENGINE_API_URL"] || "https://api.openai.com/v1").replace(/\/+$/, "");
function key() {
  const k = process.env["ENGINE_API_KEY"];
  if (!k) throw new EngineError(503);
  return k;
}

async function call(path: string, body: BodyInit, json: boolean) {
  const r = await fetch(url() + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, ...(json ? { "Content-Type": "application/json" } : {}) },
    body,
  });
  if (!r.ok) throw new EngineError(r.status >= 500 ? 502 : r.status);
  return r.json();
}

export async function transcribeAudio(o: { file: Blob; language?: string | undefined; prompt?: string | undefined }) {
  const fd = new FormData();
  fd.append("model", process.env["ENGINE_SPEECH_MODEL"] || "gpt-4o-transcribe");
  fd.append("file", o.file, (o.file as File).name || "chunk.webm");
  if (o.language) fd.append("language", o.language);
  if (o.prompt) fd.append("prompt", o.prompt);
  fd.append("response_format", "json");
  fd.append("temperature", "0");
  const res = (await call("/audio/transcriptions", fd, false)) as { text?: string };
  return res.text ?? "";
}

export async function generateText(input: string) {
  const res = (await call("/responses", JSON.stringify({ model: process.env["ENGINE_TEXT_MODEL"] || "gpt-4.1", input }), true)) as {
    output?: { type: string; content?: { type: string; text?: string }[] }[];
  };
  return (res.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .map((c) => (c.type === "output_text" ? c.text ?? "" : ""))
    .join("")
    .trim();
}

export async function generateImage(prompt: string) {
  const res = (await call("/images/generations", JSON.stringify({ model: process.env["ENGINE_IMAGE_MODEL"] || "gpt-image-1", prompt, size: "1536x1024", quality: "medium" }), true)) as {
    data?: { b64_json?: string }[];
  };
  return res.data?.[0]?.b64_json;
}
