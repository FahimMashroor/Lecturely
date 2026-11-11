const RULES = "Write in plain text. Use '## ' for headings and '- ' for bullet points. No other markdown symbols. Never mention that you are an AI or assistant.";

export const TASKS: Record<string, string> = {
  clean: "This is an automatic lecture transcript that contains mis-heard words. Fix only words that were clearly mis-heard (use the context and the key terms list), fix punctuation and obvious repeated fragments. Do not summarise, shorten, reorder or reword anything else. Output only the corrected transcript.",
  translate_en: "Translate the following lecture transcript into clear, natural English. Keep every point, number and term. Output only the translation.",
  translate_bn: "Translate the following lecture transcript into natural Bangla (Bengali script). Keep technical terms in English in brackets when helpful. Output only the translation.",
  summary: "Write a clear summary of this lecture in a few short paragraphs, covering the main ideas in the order they were taught. " + RULES,
  bullets: "Turn this lecture into well-organised study notes: headings for each topic, with concise bullet points for key ideas, definitions and formulas. " + RULES,
  examples: "For each main concept in this lecture, give a short explanation and 1-2 concrete worked examples or real-world examples that make it easy to understand. " + RULES,
  lesson: 'Create an interactive lesson from this lecture. Reply with JSON only, no code fences, in this exact shape: {"sections":[{"title":string,"explain":string}],"quiz":[{"q":string,"options":[string,string,string,string],"answer":number,"why":string}]}. Use 3-6 sections and 6-10 quiz questions; "answer" is the 0-based index of the correct option.',
};

export function buildPrompt(mode: string, text: string, langName?: string, terms?: string) {
  const task = TASKS[mode];
  if (!task) return null;
  const note = langName && !mode.startsWith("translate") && mode !== "clean" ? ` The lecture was spoken in ${langName}; write the result in English.` : "";
  const t = mode === "clean" && terms ? `\nKey terms: ${terms}` : "";
  return `${task}${note}${t}\n\nTRANSCRIPT:\n${text}`;
}

export function parseLesson(out: string) {
  return JSON.parse(out.replace(/^```(json)?|```$/g, "").trim());
}
