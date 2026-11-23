/// <reference lib="webworker" />
// The on-device speech engine runs here, in a "worker": a helper that works
// next to the screen instead of on it. Turning 30 seconds of speech into text
// takes the phone many seconds of hard work. When that work ran on the screen
// itself, the screen could not scroll or react to taps until it finished.
// Now the screen stays free while this helper writes.
import { pipeline, env } from "@huggingface/transformers";

const SPEECH_MODEL = "onnx-community/whisper-base";
// A bigger engine trained only on English. It makes clearly fewer mistakes on
// English (all accents) than the all-languages engine above, but knows no other language.
const ENGLISH_MODEL = "Xenova/whisper-small.en";

type Req =
  | { id: number; type: "load"; english: boolean; isApp: boolean }
  | { id: number; type: "run"; english: boolean; isApp: boolean; audio: Float32Array; lang?: string };

const engines: { base?: Promise<any>; en?: Promise<any> } = {};

// Some phones say they have a graphics chip the engine can use, but then
// can't actually give it one. Ask for it first, so the engine doesn't fail.
async function gpuWorks() {
  try { return !!(await (navigator as any).gpu?.requestAdapter()); } catch { return false; }
}

function load(id: number, english: boolean, isApp: boolean) {
  const key = english ? "en" : "base";
  if (engines[key]) return engines[key]!;
  // The Android app carries the speech engine's program files inside itself,
  // so they are not fetched from the internet (the website loads them from a public file host).
  if (isApp) {
    (env as any).backends.onnx.wasm.wasmPaths = {
      mjs: "/ort/ort-wasm-simd-threaded.asyncify.mjs",
      wasm: "/ort/ort-wasm-simd-threaded.asyncify.wasm",
    };
  }
  const files: Record<string, { loaded: number; total: number }> = {};
  const make = (gpu: boolean) => pipeline("automatic-speech-recognition", english ? ENGLISH_MODEL : SPEECH_MODEL, {
    device: gpu ? "webgpu" : "wasm",
    dtype: gpu ? "fp32" : "q8",
    progress_callback: (e: any) => {
      if (e.status === "progress" && e.file) {
        files[e.file] = { loaded: e.loaded, total: e.total };
        const all = Object.values(files);
        const tot = all.reduce((a, f) => a + f.total, 0);
        self.postMessage({ id, type: "progress", pct: tot ? Math.round((all.reduce((a, f) => a + f.loaded, 0) / tot) * 100) : 0 });
      }
    },
  } as any);
  const p = (async () => {
    // The English engine always uses the compact files (about 250 MB). Its full-size files are about 1 GB.
    if (!english && (await gpuWorks())) {
      try { return await make(true); } catch { /* fall back to the processor below */ }
    }
    return make(false);
  })();
  engines[key] = p;
  // If loading fails (for example no internet), allow a new try later.
  p.catch(() => { if (engines[key] === p) delete engines[key]; });
  return p;
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const m = ev.data;
  try {
    const p = await load(m.id, m.english, m.isApp);
    if (m.type === "load") { self.postMessage({ id: m.id, type: "done" }); return; }
    // The English engine must not be told a language: it only knows English.
    const res = await p(m.audio, { chunk_length_s: 30, stride_length_s: 5, ...(m.english ? {} : { task: "transcribe", ...(m.lang ? { language: m.lang } : {}) }) });
    const text = (Array.isArray(res) ? res[0]?.text : res?.text ?? "") as string;
    self.postMessage({ id: m.id, type: "done", text: (text || "").trim() });
  } catch (e: any) {
    self.postMessage({ id: m.id, type: "error", message: String(e?.message ?? e) });
  }
};
