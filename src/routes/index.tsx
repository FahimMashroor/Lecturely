import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Copy, Download, FileText, GraduationCap, Languages, Lightbulb, Library, ListChecks, Loader2, Mic, Network, Save, Sparkles, Trash2, WandSparkles, WifiOff } from "lucide-react";
import { LANGUAGES } from "@/lib/languages";
import { downloadDoc, downloadTxt, savePdf } from "@/lib/export";
import { buildPrompt, parseLesson } from "@/lib/prompts";
import { mergeOverlap } from "@/lib/merge";
import { api, appBridge, copyText, hasServer } from "@/lib/native";
import { InstallButton } from "@/components/InstallButton";
import { canWriteHere, getPacks, loadNotes, loadSpeech, rememberPacks, transcribeOffline, writeOffline } from "@/lib/offline";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lecturely — Live Lecture Transcripts by Fahim Mashroor" },
      { name: "description", content: "Capture every word of a lecture live in 90+ languages, translate it, and turn it into notes, summaries and lessons." },
      { property: "og:title", content: "Lecturely — Live Lecture Transcripts" },
      { property: "og:description", content: "Capture every word of a lecture live in 90+ languages, translate it, and turn it into notes, summaries and lessons." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Session = { id: string; title: string; date: string; text: string };
type Lesson = { sections: { title: string; explain: string }[]; quiz: { q: string; options: string[]; answer: number; why: string }[] };
type Output = { mode: string; label: string; text?: string | undefined; lesson?: Lesson | undefined; image?: string | undefined };
const KEY = "lectern-sessions";
const PIECE_MS = 30000;
// Each piece starts this long before the previous one ends, so no word is cut
// in half or lost in the gap between pieces. The repeated words are removed by
// mergeOverlap.
const OVERLAP_MS = 3000;

const TOOLS: [string, string][] = [
  ["clean", "Fix mistakes"],
  ["translate_en", "Translate to English"],
  ["translate_bn", "English → Bangla"],
  ["summary", "Summary"],
  ["bullets", "Bullet-point notes"],
  ["lesson", "Interactive lesson"],
  ["examples", "Examples"],
  ["visual", "Visual diagram"],
];

const TOOL_ICONS: Record<string, typeof Mic> = { clean: WandSparkles, translate_en: Languages, translate_bn: Languages, summary: FileText, bullets: ListChecks, lesson: GraduationCap, examples: Lightbulb, visual: Network };

function Rich({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {text.split("\n").map((l, i) =>
        l.startsWith("## ") ? <h3 key={i} className="mt-4 font-display text-lg">{l.slice(3)}</h3>
        : l.startsWith("- ") ? <p key={i} className="pl-4 before:-ml-4 before:mr-2 before:content-['•']">{l.slice(2)}</p>
        : l.trim() ? <p key={i}>{l}</p> : null,
      )}
    </div>
  );
}

function LessonView({ lesson }: { lesson: Lesson }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const score = lesson.quiz.filter((q, i) => picked[i] === q.answer).length;
  return (
    <div className="space-y-5">
      {lesson.sections.map((s, i) => (
        <details key={i} className="rounded-xl border border-border bg-card p-4" open={i === 0}>
          <summary className="cursor-pointer font-medium">{i + 1}. {s.title}</summary>
          <p className="mt-2 text-muted-foreground">{s.explain}</p>
        </details>
      ))}
      <h3 className="font-display text-lg">Check yourself — {score}/{lesson.quiz.length}</h3>
      {lesson.quiz.map((q, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 font-medium">{q.q}</p>
          <div className="grid gap-2">
            {q.options.map((o, j) => {
              const done = picked[i] !== undefined;
              const cls = done && j === q.answer ? "border-primary bg-primary/10" : done && picked[i] === j ? "border-destructive bg-destructive/10" : "border-border hover:bg-accent";
              return <button key={j} disabled={done} onClick={() => setPicked({ ...picked, [i]: j })} className={`rounded-xl border px-3 py-2.5 text-left text-sm ${cls}`}>{o}</button>;
            })}
          </div>
          {picked[i] !== undefined && <p className="mt-2 text-sm text-muted-foreground">{q.why}</p>}
        </div>
      ))}
    </div>
  );
}

const lessonToText = (l: Lesson) =>
  l.sections.map((s) => `## ${s.title}\n${s.explain}`).join("\n\n") +
  "\n\n## Quiz\n" + l.quiz.map((q, i) => `- ${i + 1}. ${q.q} (Answer: ${q.options[q.answer]})`).join("\n");

function Index() {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [title, setTitle] = useState("");
  const [lang, setLang] = useState("en");
  const [terms, setTerms] = useState("");
  const [err, setErr] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [busy, setBusy] = useState("");
  const [out, setOut] = useState<Output | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recsRef = useRef<Set<MediaRecorder>>(new Set());
  const runRef = useRef(0);
  // True when the end of the transcript came from the online engine, so the
  // next online piece can be safely merged with it.
  const mergeableRef = useRef(false);
  const wantRef = useRef(false);
  const textRef = useRef("");
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const laterRef = useRef<{ blob: Blob; mark: string }[]>([]);
  const [online, setOnline] = useState(true);
  const [laterCount, setLaterCount] = useState(0);
  const [packs, setPacks] = useState<{ speech?: boolean; speechEn?: boolean; notes?: boolean }>({});
  const [dl, setDl] = useState<{ speech?: number; speechEn?: number; notes?: number }>({});
  // Keeps the phone screen awake while recording. If the screen turns off,
  // the phone pauses the microphone and part of the lecture would be lost.
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const [away, setAway] = useState(false);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") setSupported(false);
    try { setSessions(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {}
    setPacks(getPacks());
    const upd = () => setOnline(navigator.onLine);
    upd(); window.addEventListener("online", upd); window.addEventListener("offline", upd);
    return () => { window.removeEventListener("online", upd); window.removeEventListener("offline", upd); };
  }, []);

  const transcribeOnline = async (blob: Blob) => {
    const fd = new FormData();
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    fd.append("file", new File([blob], `chunk.${ext}`, { type: blob.type }));
    if (lang) fd.append("language", lang);
    if (terms.trim()) fd.append("keywords", terms);
    fd.append("prompt", textRef.current.slice(-600));
    const r = await fetch(api("/api/transcribe"), { method: "POST", body: fd });
    if (!r.ok) throw new Error();
    const { text } = await r.json();
    return ((text as string) || "").trim();
  };

  const append = (t: string, merge = false) => setFinalText((p) => {
    const n = (merge ? mergeOverlap(p, t) : (p ? p.trimEnd() + " " : "") + t) + " ";
    textRef.current = n; return n;
  });

  // When the connection returns, redo offline parts with the stronger engine.
  const redoLater = async () => {
    const items = [...laterRef.current];
    for (const it of items) {
      try {
        const t = await transcribeOnline(it.blob);
        setFinalText((p) => { const n = p.replace(it.mark, t); textRef.current = n; return n; });
        laterRef.current = laterRef.current.filter((x) => x !== it);
        setLaterCount(laterRef.current.length);
      } catch { return; }
    }
  };
  useEffect(() => { if (online && laterRef.current.length) redoLater(); }, [online]);

  const getPack = async (kind: "speech" | "speechEn" | "notes") => {
    setErr("");
    try {
      setDl((d) => ({ ...d, [kind]: 0 }));
      const on = (n: number) => setDl((d) => ({ ...d, [kind]: n }));
      if (kind === "speech") await loadSpeech(on); else if (kind === "speechEn") await loadSpeech(on, true); else await loadNotes(on);
      rememberPacks({ [kind]: true }); setPacks(getPacks());
    } catch (e: any) {
      setErr(e?.message === "nogpu" ? "This phone or browser can't run offline notes. Try the latest Chrome." : "The offline pack couldn't be downloaded. Check your connection and try again.");
    } finally { setDl((d) => ({ ...d, [kind]: undefined })); }
  };

  useEffect(() => { textRef.current = finalText; }, [finalText]);
  useEffect(() => { if (listening) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [finalText, interim, listening]);

  const send = (blob: Blob) => {
    pendingRef.current++; setInterim(" Writing…");
    queueRef.current = queueRef.current.then(async () => {
      try {
        if (hasServer && navigator.onLine) {
          try {
            const t = await transcribeOnline(blob);
            if (t) { append(t, mergeableRef.current); mergeableRef.current = true; }
            return;
          } catch {}
        }
        if (canWriteHere(lang)) {
          setInterim(" Writing on this device…");
          const t = await transcribeOffline(blob, lang || undefined);
          const mark = t ? t : "[…]";
          append(mark); mergeableRef.current = false;
          // With no server there is no stronger engine to redo this part later.
          if (hasServer) { laterRef.current.push({ blob, mark }); setLaterCount(laterRef.current.length); }
        } else {
          const mark = `[part ${laterRef.current.length + 1} recorded — will be written when you're back online]`;
          append(mark); mergeableRef.current = false;
          laterRef.current.push({ blob, mark }); setLaterCount(laterRef.current.length);
        }
      } catch { setErr("A part of the lecture couldn't be transcribed."); }
      finally { pendingRef.current--; if (!pendingRef.current) setInterim(""); }
    });
  };

  const recordPiece = (stream: MediaStream, run: number, live: Set<MediaRecorder>) => {
    const active = () => wantRef.current && runRef.current === run;
    if (!active()) return;
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onstop = () => {
      live.delete(rec);
      if (parts.length) send(new Blob(parts, { type: rec.mimeType }));
      // Release the microphone only after every piece of this recording has finished.
      if (!active() && live.size === 0) {
        stream.getTracks().forEach((t) => t.stop());
        if (streamRef.current === stream) streamRef.current = null;
      }
    };
    live.add(rec);
    rec.start();
    // Start the next piece before this one stops, so the pieces overlap.
    setTimeout(() => recordPiece(stream, run, live), PIECE_MS);
    setTimeout(() => { if (rec.state === "recording") rec.stop(); }, PIECE_MS + OVERLAP_MS);
  };

  const keepAwake = async () => {
    appBridge()?.keepAwake(true);
    try {
      const wl = (navigator as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (wl && !wakeRef.current) {
        const lock = await wl.request("screen");
        wakeRef.current = lock;
        (lock as unknown as EventTarget).addEventListener?.("release", () => { if (wakeRef.current === lock) wakeRef.current = null; });
      }
    } catch {}
  };
  const letSleep = () => { appBridge()?.keepAwake(false); wakeRef.current?.release().catch(() => {}); wakeRef.current = null; };

  // The phone drops the screen lock when you switch apps; take it again when
  // you come back, and remember that the app was hidden during the recording.
  useEffect(() => {
    const onVis = () => {
      if (!wantRef.current) return;
      if (document.visibilityState === "visible") keepAwake(); else setAway(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const start = async () => {
    setErr("");
    if (!hasServer && !canWriteHere(lang)) {
      setErr(getPacks().speechEn ? "The pack you downloaded only knows English. For other languages, scroll down to “Transcription packs” and download “Transcription”." : "One more step: download a transcription pack first. Scroll down to “Transcription packs” and tap Download.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e: any) {
      setErr(e?.name === "NotFoundError" ? "No microphone found. Plug one in or check your sound settings."
        : "Microphone is blocked. Open this app in its own browser tab and allow the microphone.");
      return;
    }
    streamRef.current = stream;
    const live = new Set<MediaRecorder>();
    recsRef.current = live;
    const run = ++runRef.current;
    // A new recording never overlaps the previous one, so don't merge across it.
    mergeableRef.current = false;
    wantRef.current = true; setListening(true); setAway(false);
    keepAwake();
    recordPiece(stream, run, live);
  };

  const stop = () => {
    wantRef.current = false;
    letSleep();
    recsRef.current.forEach((r) => { if (r.state === "recording") r.stop(); });
    setListening(false);
  };

  const save = () => {
    if (!finalText.trim()) return;
    const s: Session = { id: crypto.randomUUID(), title: title.trim() || "Untitled lecture", date: new Date().toLocaleString(), text: finalText.trim() };
    const next = [s, ...sessions];
    setSessions(next); localStorage.setItem(KEY, JSON.stringify(next));
    setFinalText(""); setTitle(""); setOut(null);
  };

  const remove = (id: string) => {
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next); localStorage.setItem(KEY, JSON.stringify(next));
  };

  const runTool = async (mode: string, label: string) => {
    setErr(""); setBusy(mode);
    const langName = LANGUAGES.find(([c]) => c === lang)?.[1];
    const done = (d: { text?: string; caption?: string; lesson?: Lesson; image?: string }) =>
      setOut({ mode, label, text: d.text ?? d.caption, lesson: d.lesson, image: d.image });
    try {
      if (hasServer && navigator.onLine) {
        try {
          const r = await fetch(api("/api/study"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, text: finalText, langName, terms }) });
          if (r.ok) { done(await r.json()); return; }
        } catch {}
      }
      if (mode === "visual") throw new Error(hasServer ? "Diagrams need an internet connection." : "Diagrams aren't available in this version of the app yet.");
      if (!getPacks().notes) throw new Error(hasServer ? "You're offline. Download the offline notes pack first (below)." : "Download the notes pack first. Scroll down to “Transcription packs”.");
      const prompt = buildPrompt(mode, finalText.slice(0, 10000), langName, terms)!;
      const t = await writeOffline(prompt);
      if (mode === "lesson") done({ lesson: parseLesson(t) }); else done({ text: t });
    } catch (e: any) { setErr(e?.message && e.message.length > 5 ? e.message : `Couldn't make the ${label.toLowerCase()}. Please try again.`); }
    finally { setBusy(""); }
  };

  const outText = out ? (out.lesson ? lessonToText(out.lesson) : out.text ?? "") : "";
  const outTitle = `${title || "Lecture"} — ${out?.label ?? ""}`;
  const words = finalText.trim() ? finalText.trim().split(/\s+/).length : 0;
  const btn = "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-40";
  const ghost = `${btn} border border-border bg-card hover:-translate-y-0.5 hover:border-primary-glow/40 hover:shadow-soft`;
  const docName = title || "Lecture";
  const field = "rounded-xl border border-input bg-card px-4 py-3 text-sm shadow-soft outline-none transition focus:border-primary-glow focus:ring-4 focus:ring-ring/15";
  const mins = words ? Math.max(1, Math.round(words / 130)) : 0;

  return (
    <div className="min-h-screen bg-background bg-dots text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl shadow-soft" />
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl sm:text-2xl font-extrabold leading-none tracking-tight">Lecturely</h1>
              <p className="truncate text-xs text-muted-foreground">by Fahim Mashroor</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
          <InstallButton />
          <span title={online ? "Online" : "Offline mode"} className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${online ? "bg-mint text-mint-foreground" : "bg-accent text-accent-foreground"}`}>
            <span className={`h-2 w-2 rounded-full ${online ? "bg-mint-foreground" : "bg-highlight"}`} /><span className="hidden min-[360px]:inline">{online ? "Online" : "Offline mode"}</span>
          </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <section className="animate-rise relative mb-8 overflow-hidden rounded-3xl bg-hero p-7 text-primary-foreground shadow-soft md:p-10">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-highlight/30 blur-3xl" />
          <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
            <div>
              <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-primary-foreground/70">Your lecture companion</p>
              <h2 className="font-display text-3xl font-extrabold leading-tight md:text-5xl">Never miss a word<br />your professor says.</h2>
              <p className="mt-3 max-w-lg text-primary-foreground/80">Record, read along live, then turn it into notes, quizzes and diagrams — in 90+ languages.</p>
              <div className="mt-6 flex flex-wrap gap-3 text-sm">
                {[[words, "words captured"], [mins, "min of reading"], [sessions.length, "lectures saved"]].map(([n, l]) => (
                  <div key={l as string} className="rounded-2xl bg-primary-foreground/10 px-4 py-2 backdrop-blur">
                    <span className="font-display text-xl font-bold">{n}</span> <span className="text-primary-foreground/75">{l}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-center gap-3">
              <button onClick={listening ? stop : start} disabled={!listening && !supported} aria-label={listening ? "Stop recording" : "Start recording"}
                className={`relative grid h-32 w-32 place-items-center rounded-full font-display text-lg font-bold transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 ${listening ? "bg-destructive text-destructive-foreground" : "bg-warm text-highlight-foreground shadow-glow"}`}>
                {listening && <span className="absolute inset-0 animate-ping rounded-full bg-destructive/40" />}
                {listening ? (
                  <span className="relative flex h-10 items-center gap-1">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="animate-wave h-full w-1.5 rounded-full bg-destructive-foreground" style={{ animationDelay: `${i * 0.12}s` }} />)}</span>
                ) : <Mic className="h-12 w-12" />}
              </button>
              <span className="text-sm font-semibold">{listening ? "Listening… tap to stop" : "Tap to start"}</span>
            </div>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
          <section className="min-w-0 space-y-6">
            {!supported && <p className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">Live transcription needs Chrome, Edge or Safari. Please open this page in one of those.</p>}
            {listening && <p className="rounded-2xl bg-secondary p-4 text-sm text-secondary-foreground">Keep Lecturely open on the screen while it records. On phones, switching to another app or locking the screen can pause the microphone.</p>}
            {away && !listening && <p className="rounded-2xl bg-accent p-4 text-sm text-accent-foreground">Lecturely was in the background during the recording, so some parts may be missing. Next time, keep it open on the screen.</p>}
            {err && <p className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">{err}</p>}
            {!online && hasServer && <p className="rounded-2xl bg-accent p-4 text-sm text-accent-foreground">You're offline.{canWriteHere(lang) ? " Lectures are written on this device and improved automatically when you're back online." : " Recording continues and will be written when you're back online."}</p>}
            {laterCount > 0 && online && <p className="text-sm text-muted-foreground">Improving {laterCount} offline part(s)…</p>}

            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lecture title, e.g. Thermodynamics · Week 3" className={field} />
              <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={listening} aria-label="Spoken language" className={field}>
                {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
              <input value={terms} onChange={(e) => setTerms(e.target.value)} disabled={listening}
                placeholder="Key terms & names (e.g. PRG, AES, Prof. Andersson) — boosts accuracy" className={`${field} sm:col-span-2`} />
            </div>

            <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
              <div className="flex items-center justify-between border-b border-border px-6 py-3">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`h-2.5 w-2.5 rounded-full ${listening ? "animate-pulse bg-destructive" : "bg-muted-foreground/30"}`} />
                  {listening ? "Live transcript" : "Transcript"}
                </span>
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">{words} words</span>
              </div>
              <div className="h-[48vh] overflow-y-auto px-6 py-5 font-serif text-lg leading-[1.85]">
                {!finalText && !interim && (
                  <div className="grid h-full place-items-center text-center text-muted-foreground">
                    <div><BookOpen className="mx-auto mb-3 h-10 w-10 text-primary-glow/50" /><p className="font-sans">Tap the orange button and the lecture appears here,<br />about every 30 seconds.</p></div>
                  </div>
                )}
                <span className="whitespace-pre-wrap">{finalText}</span>
                <span className="text-muted-foreground">{interim}</span>
                <div ref={endRef} />
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/50 px-4 py-3">
                <button onClick={save} disabled={!finalText || listening} className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90`}><Save className="h-4 w-4" />Save</button>
                <button onClick={() => copyText(finalText)} disabled={!finalText} className={ghost}><Copy className="h-4 w-4" />Copy</button>
                <button onClick={() => downloadTxt(docName, finalText)} disabled={!finalText} className={ghost}>.txt</button>
                <button onClick={() => downloadDoc(docName, finalText)} disabled={!finalText} className={ghost}>Word</button>
                <button onClick={() => savePdf(docName, finalText)} disabled={!finalText} className={ghost}>PDF</button>
                <button onClick={() => { setFinalText(""); setOut(null); }} disabled={!finalText || listening} className={`${btn} ml-auto text-muted-foreground hover:text-destructive`}><Trash2 className="h-4 w-4" />Clear</button>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
              <div className="mb-5 flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warm text-highlight-foreground"><Sparkles className="h-5 w-5" /></span>
                <div>
                  <h2 className="font-display text-xl font-bold">Study tools</h2>
                  <p className="text-sm text-muted-foreground">Turn the lecture into whatever helps you learn.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {TOOLS.map(([m, l]) => {
                  const T = TOOL_ICONS[m] ?? Sparkles;
                  const on = out?.mode === m;
                  return (
                    <button key={m} onClick={() => runTool(m, l)} disabled={!finalText.trim() || !!busy || listening}
                      className={`group flex flex-col items-start gap-3 rounded-2xl border p-4 text-left text-sm font-semibold transition-all hover:-translate-y-1 hover:shadow-soft disabled:pointer-events-none disabled:opacity-45 ${on ? "border-primary-glow bg-secondary" : "border-border bg-card"}`}>
                      <span className={`grid h-9 w-9 place-items-center rounded-xl transition-colors ${on ? "bg-primary text-primary-foreground" : "bg-secondary text-primary group-hover:bg-primary group-hover:text-primary-foreground"}`}>
                        {busy === m ? <Loader2 className="h-4 w-4 animate-spin" /> : <T className="h-4 w-4" />}
                      </span>
                      {busy === m ? "Working…" : l}
                    </button>
                  );
                })}
              </div>

              {out && (
                <div className="animate-rise mt-6 rounded-2xl bg-muted/60 p-5">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <h3 className="mr-auto font-display text-lg font-bold">{out.label}</h3>
                    <button onClick={() => copyText(outText)} className={ghost}><Copy className="h-4 w-4" />Copy</button>
                    <button onClick={() => downloadDoc(outTitle, outText, out.image)} className={ghost}>Word</button>
                    <button onClick={() => savePdf(outTitle, outText, out.image)} className={ghost}>PDF</button>
                    {(out.mode.startsWith("translate") || out.mode === "clean") && (
                      <button onClick={() => { setFinalText(outText + " "); setOut(null); }} className={`${btn} bg-primary text-primary-foreground`}>Use as transcript</button>
                    )}
                  </div>
                  <div className="font-serif leading-relaxed">
                    {out.image && <img src={out.image} alt={`Diagram for ${docName}`} className="mb-3 w-full rounded-xl border border-border" />}
                    {out.lesson ? <LessonView lesson={out.lesson} /> : <Rich text={out.text ?? ""} />}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
              <div className="mb-5 flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mint text-mint-foreground"><WifiOff className="h-5 w-5" /></span>
                <div>
                  <h2 className="font-display text-xl font-bold">{hasServer ? "Use without internet" : "Transcription packs"}</h2>
                  <p className="text-sm text-muted-foreground">{hasServer ? "Download once on Wi-Fi — keep working when the signal drops." : "Download once on Wi-Fi. After that, everything is written on this phone and your audio never leaves it."}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {([["speech", hasServer ? "Offline transcription" : "Transcription", hasServer ? "About 80 MB. Less accurate than online." : "About 80 MB. All languages."], ["speechEn", "High-accuracy English", "About 250 MB. Fewer mistakes on English lectures, any accent. Best on a newer phone."], ["notes", hasServer ? "Offline notes & summaries" : "Notes & summaries", hasServer ? "About 1 GB. Needs a newer phone and latest Chrome." : "About 1 GB. Needs a newer phone."]] as const).map(([k, n, d]) => (
                  <div key={k} className="rounded-2xl border border-border p-4">
                    <p className="font-semibold">{n}</p>
                    <p className="mb-3 text-xs text-muted-foreground">{d}</p>
                    {packs[k] ? <span className="inline-flex items-center gap-1 rounded-full bg-mint px-3 py-1 text-xs font-semibold text-mint-foreground"><Check className="h-3.5 w-3.5" />Ready</span> : dl[k] !== undefined ? (
                      <div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-warm transition-all" style={{ width: `${dl[k]}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">Downloading {dl[k]}%</p></div>
                    ) : <button onClick={() => getPack(k)} disabled={!online} className={ghost}><Download className="h-4 w-4" />Download</button>}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-3xl border border-border bg-card p-5 shadow-soft">
              <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold"><Library className="h-5 w-5 text-primary-glow" />My lectures</h2>
              {sessions.length === 0 && <p className="rounded-2xl bg-muted p-4 text-center text-sm text-muted-foreground">Your saved lectures will live here. 📚</p>}
              <ul className="max-h-[70vh] space-y-3 overflow-y-auto">
                {sessions.map((s) => (
                  <li key={s.id} className="group rounded-2xl border border-border p-3 transition hover:border-primary-glow/40 hover:bg-secondary/50">
                    <button onClick={() => { setFinalText(s.text + " "); setTitle(s.title); setOut(null); }} className="block w-full text-left">
                      <p className="truncate font-semibold">{s.title}</p>
                      <p className="text-xs text-muted-foreground">{s.date}</p>
                    </button>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                      <button onClick={() => downloadDoc(s.title, s.text)} className="text-primary-glow hover:underline">Word</button>
                      <button onClick={() => savePdf(s.title, s.text)} className="text-primary-glow hover:underline">PDF</button>
                      <button onClick={() => remove(s.id)} className="ml-auto text-muted-foreground hover:text-destructive">Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </main>
      <footer className="mt-8 border-t border-border py-6 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Fahim Mashroor. All rights reserved. Lecturely™ is a trademark of Fahim Mashroor. Unauthorised copying or distribution is prohibited.</footer>
    </div>
  );
}
