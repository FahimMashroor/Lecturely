import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

// Lets people put Lecturely on their phone or laptop like a normal app.
// Android / Chrome / Edge: the browser shows its own "Install" box.
// iPhone / iPad: Safari has no install box, so we show the two steps instead.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isApple() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function InstallButton() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [apple, setApple] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    setInstalled(isInstalled());
    setApple(isApple());
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); };
    const onDone = () => { setInstalled(true); setEvt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onDone);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onDone); };
  }, []);

  if (installed || (!evt && !apple)) return null;

  const click = async () => {
    if (evt) { await evt.prompt(); await evt.userChoice.catch(() => null); setEvt(null); }
    else setHelp(true);
  };

  return (
    <>
      <button onClick={click} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
        <Download className="h-3.5 w-3.5" />Install<span className="hidden sm:inline"> app</span>
      </button>
      {help && (
        <div role="dialog" aria-modal="true" aria-label="Install Lecturely" className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-4 sm:place-items-center" onClick={() => setHelp(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-card p-6 text-card-foreground shadow-soft" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Add Lecturely to your Home Screen</h2>
              <button onClick={() => setHelp(false)} aria-label="Close" className="text-muted-foreground"><X className="h-5 w-5" /></button>
            </div>
            <ol className="space-y-3 text-sm">
              <li>1. Tap the <Share className="inline h-4 w-4 align-text-bottom" /> <b>Share</b> button in Safari.</li>
              <li>2. Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
              <li>3. Open Lecturely from its new icon on your Home Screen.</li>
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">If you can't find Add to Home Screen, open this page in Safari and try again.</p>
          </div>
        </div>
      )}
    </>
  );
}
