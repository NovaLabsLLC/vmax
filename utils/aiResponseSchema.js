/**
 * Shared structured output from planning / diagnosis / diff models.
 * Validated with Zod; malformed responses get a safe fallback (never throws upstream).
 */

const { z } = require("zod");

const ExecStructuredResponseSchema = z.object({
  summary: z.string(),
  what_vmax_sees: z.string(),
  likely_problem: z.string(),
  next_steps: z.array(z.string()),
  cursor_prompt: z.string(),
  claude_prompt: z.string(),
  suggested_commands: z.array(z.string()),
  execution_recommendation: z.string(),
  /** 1–2 short spoken sentences for TTS; conversational, no code or lists */
  speakable_summary: z.string(),
});

function formatZodError(zodError) {
  return zodError.issues.map((i) => `${i.path.length ? i.path.join(".") : "root"}: ${i.message}`).join("; ");
}

/** Safe fallback that always satisfies the schema (for internal use after coerce). */
function malformedStructuredResponse(hint) {
  const detail = String(hint || "unknown")
    .replace(/[\u0000-\u001f]/g, " ")
    .slice(0, 280);
  return {
    summary:
      "Vmax could not parse the model reply — it was missing fields or not valid JSON. Nothing was executed; you can try again.",
    what_vmax_sees: "",
    likely_problem: detail,
    next_steps: [
      `Error from model: ${detail}`,
      "Retry with a shorter task or question",
      "Confirm API keys in .env and network access",
    ],
    cursor_prompt: "",
    claude_prompt: "",
    suggested_commands: [],
    execution_recommendation: "none",
    speakable_summary:
      "I couldn't parse that reply — nothing ran. Try a shorter question or check your API keys, then ask again.",
  };
}

/**
 * @param {unknown} rawObject - already parsed JSON
 * @returns {{ ok: boolean, data: z.infer<typeof ExecStructuredResponseSchema> }}
 */
function validateStructuredResponse(rawObject) {
  const parsed = ExecStructuredResponseSchema.safeParse(rawObject);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, data: malformedStructuredResponse(formatZodError(parsed.error)) };
}

module.exports = {
  ExecStructuredResponseSchema,
  validateStructuredResponse,
  malformedStructuredResponse,
  formatZodError,
};
