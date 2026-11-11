// Small helpers for the Android app version of Lecturely.
// In the Android app the screens run inside the app itself, and the app gives
// the page a few extra abilities (save a file, print, keep the screen awake).
type AppBridge = {
  saveFile: (name: string, mime: string, base64: string) => void;
  printHtml: (title: string, html: string) => void;
  keepAwake: (on: boolean) => void;
  copy: (text: string) => void;
};

export const appBridge = (): AppBridge | null =>
  typeof window === "undefined" ? null : ((window as unknown as { LecturelyApp?: AppBridge }).LecturelyApp ?? null);

/** True when this code was built for the Android app. */
export const isApp = import.meta.env.VITE_APP === "1";

/** Address of the Lecturely server, for the app. Empty means "this phone only". */
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/+$/, "");

/** The website always has its server next to it. The app has one only when an address was built in. */
export const hasServer = !isApp || !!API_BASE;

export const api = (path: string) => API_BASE + path;

export function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function copyText(text: string) {
  const b = appBridge();
  if (b) b.copy(text); else navigator.clipboard.writeText(text);
}
