import { appBridge, toBase64 } from "./native";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toHtmlBody(title: string, text: string, image?: string) {
  const body = text
    .split("\n")
    .map((l) => (l.startsWith("## ") ? `<h2>${esc(l.slice(3))}</h2>` : l.startsWith("- ") ? `<li>${esc(l.slice(2))}</li>` : l.trim() ? `<p>${esc(l)}</p>` : ""))
    .join("\n");
  return `<h1>${esc(title)}</h1>${image ? `<img src="${image}" style="max-width:100%"/>` : ""}${body}`;
}

const STYLE = "body{font-family:Georgia,'Noto Sans','Noto Sans Bengali',serif;line-height:1.6;max-width:720px;margin:24px auto;padding:0 16px}h1{font-size:24px}h2{font-size:18px;margin-top:20px}";

const fname = (n: string) => n.replace(/[^\p{L}\p{M}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || "lecture";

export function downloadDoc(title: string, text: string, image?: string) {
  const html = `<html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${toHtmlBody(title, text, image)}</body></html>`;
  const app = appBridge();
  if (app) { app.saveFile(`${fname(title)}.doc`, "application/msword", toBase64("\ufeff" + html)); return; }
  const url = URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/msword" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${fname(title)}.doc`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function downloadTxt(title: string, text: string) {
  const app = appBridge();
  if (app) { app.saveFile(`${fname(title)}.txt`, "text/plain", toBase64(text)); return; }
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${fname(title)}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Opens the browser's print dialog, where "Save as PDF" is offered. Works for every script (Bangla, Hindi, Arabic...).
export function savePdf(title: string, text: string, image?: string) {
  const app = appBridge();
  if (app) {
    app.printHtml(title, `<html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}@page{size:A4;margin:14mm}</style></head><body>${toHtmlBody(title, text, image)}</body></html>`);
    return;
  }
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}@page{size:A4;margin:14mm}</style></head><body>${toHtmlBody(title, text, image)}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}
