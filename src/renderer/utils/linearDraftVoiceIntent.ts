/** Strip optional prefix users type when drafting from overlay chat. */
export function normalizeLinearDraftTranscript(raw: string): string {
  return raw.replace(/^\s*linear\s*:\s*/i, "").trim();
}

/** Overlay mic/chat routes here → Command Center opens Add Linear task + AI draft (not agent dispatch). */
export function isLinearDraftVoiceIntent(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^linear\s*:/i.test(trimmed)) {
    return normalizeLinearDraftTranscript(trimmed).length >= 8;
  }
  if (trimmed.length < 12) return false;
  const t = trimmed.toLowerCase();
  return (
    /\b(create|add|new|file|open|log)\s+(?:a\s+|the\s+|my\s+)?(?:linear\s+)?(?:issue|task|ticket)\b/i.test(t)
    || /\b(?:linear\s+)?(?:issue|task|ticket)\s+(?:for|about|regarding)\b/i.test(t)
    || /\bremind\s+me\s+to\s+(?:create|add|file)\b/i.test(t)
  );
}
