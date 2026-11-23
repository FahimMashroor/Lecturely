// Browser-only on-device engines. Every heavy library is loaded with dynamic import.
import { isApp } from "./native";

type Progress = (pct: number) => void;

const NOTES_MODEL = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

let llm: any = null;

export const hasWebGPU = () => typeof navigator !== "undefined" && "gpu" in navigator;

// The speech engine works in a separate helper (see speech.worker.ts), so the
// screen keeps scrolling and reacting to taps while a lecture is being written.
let worker: Worker | null = null;
let nextId = 0;
const calls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: Progress | undefined }>();
const loaded = { base: false, en: false };

function helper() {
  if (worker) return worker;
  const w = new Worker(new URL("./speech.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (ev: MessageEvent<{ id: number; type: string; pct?: number; text?: string; message?: string }>) => {
    const m = ev.data;
    const c = calls.get(m.id);
    if (!c) return;
    if (m.type === "progress") { c.onProgress?.(m.pct ?? 0); return; }
    calls.delete(m.id);
    if (m.type === "done") c.resolve(m.text ?? "");
    else c.reject(new Error(m.message || "speech"));
  };
  w.onerror = () => {
    // The helper stopped unexpectedly (for example the phone ran out of memory).
    // Tell everyone who was waiting, and start a fresh helper next time.
    calls.forEach((c) => c.reject(new Error("speech")));
    calls.clear();
    loaded.base = loaded.en = false;
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

function ask(msg: Record<string, unknown>, onProgress?: Progress, transfer: Transferable[] = []) {
  const id = ++nextId;
  return new Promise<string>((resolve, reject) => {
    calls.set(id, { resolve, reject, onProgress });
    helper().postMessage({ ...msg, id, isApp }, transfer);
  });
}

export async function loadSpeech(onProgress?: Progress, english = false) {
  await ask({ type: "load", english }, onProgress);
  if (english) loaded.en = true; else loaded.base = true;
  onProgress?.(100);
}

export const speechReady = () => loaded.base;
export const notesReady = () => !!llm;

async function toPcm(blob: Blob) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    // A copy, so it can be handed over to the helper.
    return new Float32Array(buf.getChannelData(0));
  } finally { ctx.close(); }
}

/** Can this device write a lecture in this language without the server? */
export const canWriteHere = (lang?: string) => {
  const p = getPacks();
  return !!p.speech || (lang === "en" && !!p.speechEn);
};

export async function transcribeOffline(blob: Blob, lang?: string) {
  // English lectures use the English engine when its pack was downloaded.
  const english = lang === "en" && !!getPacks().speechEn;
  const audio = await toPcm(blob);
  return (await ask({ type: "run", english, audio, lang }, undefined, [audio.buffer])).trim();
}

export async function loadNotes(onProgress?: Progress) {
  if (llm) return llm;
  if (!hasWebGPU()) throw new Error("nogpu");
  const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
  llm = await CreateMLCEngine(NOTES_MODEL, {
    initProgressCallback: (r: { progress: number }) => onProgress?.(Math.round(r.progress * 100)),
  });
  return llm;
}

export async function writeOffline(prompt: string) {
  const e = await loadNotes();
  const r = await e.chat.completions.create({ messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 1200 });
  return (r.choices?.[0]?.message?.content ?? "").trim() as string;
}

const KEY = "lecturely-offline";
type Packs = { speech?: boolean; speechEn?: boolean; notes?: boolean };
export const rememberPacks = (p: Packs) => {
  const cur = getPacks();
  localStorage.setItem(KEY, JSON.stringify({ ...cur, ...p }));
};
export const getPacks = (): Packs => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
};
