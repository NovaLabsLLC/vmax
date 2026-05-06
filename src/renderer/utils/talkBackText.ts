/** Normalize copy for `speechSynthesis` — no code fences, light markup. */
export function cleanForTalkBack(text: string): string {
  if (!text) return "";
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/[*_#>|]/g, "")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampSentences(text: string, maxSentences: number, maxChars = 450): string {
  if (!text) return "";
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = parts.slice(0, maxSentences).join(" ").trim();
  if (!out) out = text.trim().slice(0, maxChars);
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars);
    const dot = cut.lastIndexOf(". ");
    const sp = cut.lastIndexOf(" ");
    const last = Math.max(dot > 40 ? dot + 1 : -1, sp > 40 ? sp : -1);
    out = (last > 40 ? cut.slice(0, last) : cut).trim();
  }
  return out;
}

/** Prefer model `speakable_summary`; otherwise compress fallback to ~2 sentences. */
export function deriveSpeakable(modelSpeakable: string | undefined, fallback: string | undefined): string {
  const m = cleanForTalkBack(modelSpeakable || "");
  if (m.length >= 14) return clampSentences(m, 2);
  const f = cleanForTalkBack(fallback || "");
  return clampSentences(f, 2);
}

/** Clip to max sentences for TTS (confirmations, etc.). */
export function toSpeakableLine(text: string, maxSentences = 2): string {
  return clampSentences(cleanForTalkBack(text), maxSentences);
}

/** For plain Ask prose (no structured field). */
export function proseToSpeakable(prose: string): string {
  return toSpeakableLine(prose, 2);
}

/** Spoken recap after OpenClaw exits (hints from last plan / failure / diff speakable). */
export function buildOpenClawSpeakable(exitCode: number, output: string, speakableHint: string | undefined): string {
  const hint = clampSentences(cleanForTalkBack(speakableHint || ""), 2, 360);
  const head =
    exitCode === 0
      ? "OpenClaw finished running checks."
      : exitCode === 125
        ? "OpenClaw blocked this run."
        : "OpenClaw exited with an error.";
  const errN = (output.match(/\berror\b/gi) || []).length;
  let mid = "";
  if (exitCode !== 0 && errN >= 2) mid += " I see multiple errors in the output.";
  else if (exitCode !== 0 && errN === 1) mid += " There's an error line worth skimming in the terminal.";
  const tail = hint ? ` ${hint}` : " Check the terminal for full detail when you're ready.";
  return clampSentences(`${head}${mid}${tail}`.replace(/\s+/g, " "), 2, 520);
}
