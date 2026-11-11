// Joins two transcript pieces whose audio overlaps by a few seconds.
// The end of `prev` and the start of `next` describe the same sound, so the
// same words appear twice. We find the longest run of words that both share
// near the join, keep `prev` up to the end of that run, and continue with
// `next` after it. If no safe match is found, we simply add `next` after `prev`.

// Scripts written without spaces between words: each character is a token.
const NO_SPACE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

type Tok = { norm: string; start: number; end: number; char: boolean };

export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const word = m[0];
    const at = m.index ?? 0;
    if (!NO_SPACE.test(word)) {
      out.push({ norm: word.toLowerCase(), start: at, end: at + word.length, char: false });
      continue;
    }
    // Split into single characters (keeping accent marks with their letter).
    for (const c of word.matchAll(/\P{M}\p{M}*/gu)) {
      const s = at + (c.index ?? 0);
      out.push({
        norm: c[0].toLowerCase(),
        start: s,
        end: s + c[0].length,
        char: NO_SPACE.test(c[0]),
      });
    }
  }
  return out;
}

export function mergeOverlap(prev: string, next: string): string {
  const p = prev.trimEnd();
  const n = next.trim();
  if (!p) return n;
  if (!n) return p;
  // Only the end of the transcript matters; skip the rest for speed.
  const off = Math.max(0, p.length - 1500);
  const a = tokenize(p.slice(off));
  const b = tokenize(n);
  if (!a.length || !b.length) return `${p} ${n}`;

  // Look only near the join: a few seconds of speech on each side.
  const charScript = [...a.slice(-10), ...b.slice(0, 10)].filter((t) => t.char).length > 10;
  const win = charScript ? 30 : 15;
  const minLen = charScript ? 5 : 3;
  const aFrom = Math.max(0, a.length - win);
  const bTo = Math.min(b.length, win);

  let best = { len: 0, i: -1, j: -1 };
  for (let i = aFrom; i < a.length; i++) {
    for (let j = 0; j < bTo; j++) {
      let len = 0;
      while (i + len < a.length && j + len < b.length && a[i + len]!.norm === b[j + len]!.norm)
        len++;
      // Prefer longer matches; on a tie prefer the one closest to the join.
      if (len > best.len || (len === best.len && len > 0 && j < best.j)) best = { len, i, j };
    }
  }
  if (best.len < minLen) return `${p} ${n}`;

  const cutA = off + a[best.i + best.len - 1]!.end;
  const cutB = b[best.j + best.len - 1]!.end;
  // `tail` starts right after the matched words, so it keeps the space or
  // punctuation that follows them in `next` (e.g. ", and then ...").
  return (p.slice(0, cutA) + n.slice(cutB)).trimEnd();
}
