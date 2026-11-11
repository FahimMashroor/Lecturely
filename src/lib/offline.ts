// Browser-only on-device engines. Every heavy library is loaded with dynamic import.
import { isApp } from "./native";

type Progress = (pct: number) => void;

const SPEECH_MODEL = "onnx-community/whisper-base";
// A bigger engine trained only on English. It makes clearly fewer mistakes on
// English (all accents) than the all-languages engine above, but knows no other language.
const ENGLISH_MODEL = "Xenova/whisper-small.en";
const NOTES_MODEL = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

let asr: any = null;
let asrEn: any = null;
let llm: any = null;

export const hasWebGPU = () => typeof navigator !== "undefined" && "gpu" in navigator;

export async function loadSpeech(onProgress?: Progress, english = false) {
  if (english ? asrEn : asr) return english ? asrEn : asr;
  const { pipeline, env } = await import("@huggingface/transformers");
  // The Android app carries the speech engine's program files inside itself,
  // so they are not fetched from the internet (the website loads them from a public file host).
  if (isApp) {
    (env as any).backends.onnx.wasm.wasmPaths = {
      mjs: "/ort/ort-wasm-simd-threaded.asyncify.mjs",
      wasm: "/ort/ort-wasm-simd-threaded.asyncify.wasm",
    };
  }
  const files: Record<string, { loaded: number; total: number }> = {};
  // The English engine always uses the compact files (about 250 MB). Its full-size files are about 1 GB.
  const gpu = hasWebGPU() && !english;
  const p = await pipeline("automatic-speech-recognition", english ? ENGLISH_MODEL : SPEECH_MODEL, {
    device: gpu ? "webgpu" : "wasm",
    dtype: gpu ? "fp32" : "q8",
    progress_callback: (p: any) => {
      if (p.status === "progress" && p.file) {
        files[p.file] = { loaded: p.loaded, total: p.total };
        const all = Object.values(files);
        const tot = all.reduce((a, f) => a + f.total, 0);
        onProgress?.(tot ? Math.round((all.reduce((a, f) => a + f.loaded, 0) / tot) * 100) : 0);
      }
    },
  } as any);
  if (english) asrEn = p; else asr = p;
  onProgress?.(100);
  return p;
}

export const speechReady = () => !!asr;
export const notesReady = () => !!llm;

async function toPcm(blob: Blob) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return buf.getChannelData(0);
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
  const p = await loadSpeech(undefined, english);
  const audio = await toPcm(blob);
  // The English engine must not be told a language: it only knows English.
  const res = await p(audio, { chunk_length_s: 30, stride_length_s: 5, ...(english ? {} : { task: "transcribe", ...(lang ? { language: lang } : {}) }) });
  return (Array.isArray(res) ? res[0]?.text : res?.text ?? "").trim() as string;
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
