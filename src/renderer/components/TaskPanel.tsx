import React, { useEffect, useRef, useState } from "react";
import { useAudio } from "../hooks/useAudio";

const HOLD_MS = 420; /* press longer than this = push-to-hold (release stops) */

type Props = {
  task: string;
  onTaskChange: (v: string) => void;
  onSend: () => void;
  /** Sends current task text into Cursor (Composer / agent) when set. */
  onRunInCursor?: () => void;
  /** Linked Linear id (viewer ref or parsed from task) — enables “mark done”. */
  linearIssueId?: string | null;
  /** PATCH workflow to completed on Linear (`state_target: done`). */
  onMarkLinearDone?: () => void | Promise<void>;
  /** Disables Linear button while PATCH in flight */
  markLinearDoneBusy?: boolean;
  onTranscribed?: (text: string) => void;
  onVoiceError?: (message: string) => void;
  sending?: boolean;
  disabled?: boolean;
  micArmToken?: number;
};

export default function TaskPanel({
  task,
  onTaskChange,
  onSend,
  onRunInCursor,
  linearIssueId,
  onMarkLinearDone,
  markLinearDoneBusy,
  onTranscribed,
  onVoiceError,
  sending,
  disabled,
  micArmToken = 0,
}: Props) {
  const audio = useAudio();
  const transcribingRef = useRef(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const canSend = !disabled && !sending && task.trim().length > 0;
  const canRunCursor = Boolean(onRunInCursor) && canSend;
  const linearIdTrim = `${linearIssueId ?? ""}`.trim();
  const showMarkLinearDone =
    linearIdTrim.length > 0 && typeof onMarkLinearDone === "function";

  const longPressArmRef = useRef(false);
  const holdPendingRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTokenRef = useRef(0);

  function clearHoldTimer() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  async function startMicSafe() {
    if (disabled || transcribingRef.current || sending) return;
    try {
      await audio.start();
      setVoiceError(null);
    } catch (err) {
      const msg =
        err instanceof Error && /Permission|NotAllowed|denied/i.test(err.message)
          ? "Microphone permission denied — tap a Linear row or use My Tasks to set the task."
          : "Couldn’t use the microphone — try again or pick a Linear issue.";
      setVoiceError(msg);
      onVoiceError?.(msg);
    }
  }

  /** After the assistant asks for confirmation, start listening so you can say "yes" hands-free. */
  useEffect(() => {
    if (!micArmToken) return;
    const timer = window.setTimeout(() => {
      if (disabled || sending || transcribingRef.current) return;
      void startMicSafe();
    }, 450);
    return () => window.clearTimeout(timer);
    // startMicSafe is intentionally excluded — token bump is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micArmToken, disabled, sending]);

  /** Keyboard push-to-talk: Option/Alt + Space toggles the mic. Ignores OS key-repeat. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isToggle = e.altKey && !e.metaKey && !e.ctrlKey && (e.code === "Space" || e.key === " ");
      if (!isToggle) return;
      if (e.repeat) return;
      e.preventDefault();
      if (disabled || transcribingRef.current || sending) return;
      if (audio.isCapturing()) void stopMic();
      else void startMicSafe();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers close over the latest audio/task via refs; deps cover the gating flags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, sending]);

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || transcribingRef.current || sending) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    longPressArmRef.current = false;
    holdPendingRef.current = false;
    clearHoldTimer();
    const myToken = ++pressTokenRef.current;
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (pressTokenRef.current !== myToken) return;
      holdPendingRef.current = true;
      void (async () => {
        if (pressTokenRef.current !== myToken) return;
        await startMicSafe();
        longPressArmRef.current = true;
      })();
    }, HOLD_MS);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    clearHoldTimer();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (disabled || transcribingRef.current) return;

    if (holdPendingRef.current) {
      holdPendingRef.current = false;
      longPressArmRef.current = false;
      void stopMic();
      return;
    }

    if (longPressArmRef.current) {
      longPressArmRef.current = false;
      void stopMic();
      return;
    }

    /* Short tap: toggle recording (click-to-talk for demo) */
    if (audio.isCapturing()) void stopMic();
    else void startMicSafe();
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLButtonElement>) {
    clearHoldTimer();
    holdPendingRef.current = false;
    longPressArmRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (audio.isCapturing()) {
      audio.discard();
    }
  }

  async function stopMic() {
    if (!audio.isCapturing()) return;
    setTranscribing(true);
    transcribingRef.current = true;
    try {
      const result = await audio.stop();
      if (!result) return;
      const { text } = await window.exec.transcribe(result);
      setVoiceError(null);
      const clean = (text || "").trim();
      if (clean) {
        const next = task.trim() ? `${task.trim()} ${clean}` : clean;
        onTaskChange(next);
        onTranscribed?.(clean);
      }
    } catch (err) {
      console.error(err);
      const msg = "Transcription failed — try speaking again.";
      setVoiceError(msg);
      onVoiceError?.(msg);
    } finally {
      transcribingRef.current = false;
      setTranscribing(false);
    }
  }

  const micActive = audio.isCapturing();

  return (
    <div className="relative rounded-2xl bg-white/[0.03] border border-white/[0.06] p-3 pr-[88px]">
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 shrink-0">Task</div>
          {onRunInCursor ? (
            <button
              type="button"
              onClick={() => onRunInCursor()}
              disabled={!canRunCursor}
              title={
                canRunCursor
                  ? "Open Cursor for this repo and paste this task into the agent"
                  : "Add a task first (mic or My Tasks)"
              }
              className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md
                         border border-white/[0.14] bg-white/[0.07] hover:bg-white/[0.11] text-white/88
                         disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              Run in Cursor
            </button>
          ) : null}
          {showMarkLinearDone ? (
            <button
              type="button"
              onClick={() => void onMarkLinearDone?.()}
              disabled={disabled || !!markLinearDoneBusy}
              aria-label={`Mark Linear issue ${linearIdTrim} done`}
              title={`Mark ${linearIdTrim} completed in Linear`}
              className="
                shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full
                border border-white/[0.08] bg-black/25 text-white/75 text-[11px] font-medium
                shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]
                transition-[color,background-color,border-color,transform] duration-150 ease-out
                hover:border-emerald-400/35 hover:bg-emerald-500/15 hover:text-emerald-100
                hover:shadow-[0_0_0_1px_rgba(52,211,153,0.1)]
                disabled:opacity-35 disabled:pointer-events-none active:scale-[0.97]
              "
            >
              {markLinearDoneBusy ? (
                <span
                  className="inline-block size-3 rounded-full border-2 border-emerald-400/30 border-t-emerald-400 animate-spin"
                  aria-hidden
                />
              ) : (
                <svg
                  className="size-3 shrink-0 text-emerald-200/95"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
              {markLinearDoneBusy ? "Updating…" : "Done"}
            </button>
          ) : null}
        </div>
        <div className="text-[10px] text-white/30 text-right ml-auto">
          Hold mic, tap to toggle, or ⌥Space
        </div>
      </div>
      {/* No text field — task comes from voice, Linear/My Tasks clicks, or other panels that call onTaskChange. */}
      <div
        aria-live="polite"
        aria-label={task.trim() ? "Current task preview" : "Task empty"}
        className={`w-full min-h-[52px] max-h-[50vh] overflow-y-auto rounded-lg border px-2.5 py-2 text-[13px] leading-relaxed
          ${disabled ? "opacity-45 pointer-events-none" : ""}
          ${task.trim()
            ? "border-white/[0.08] bg-black/20 text-white/90 whitespace-pre-wrap break-words"
            : "border-dashed border-white/[0.1] bg-white/[0.02] text-white/38"}`}
      >
        {task.trim()
          ? task
          : transcribing
            ? "Transcribing…"
            : micActive
              ? "Listening…"
              : "Use the mic below, or open an issue under My Tasks to load a task."}
      </div>

      {voiceError && !disabled && (
        <div className="text-[11px] text-amber-200/90 leading-snug mt-1.5 pr-[88px]" role="status">
          {voiceError}
        </div>
      )}

      {/* Mic — hold (release stops) or quick tap to toggle */}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        disabled={disabled || transcribing || sending}
        title="Hold to talk · tap to toggle · ⌥Space"
        aria-pressed={micActive}
        className={`absolute right-[44px] bottom-2.5 h-8 w-8 rounded-full flex items-center justify-center
                    transition-all touch-manipulation select-none
                    ${micActive
                      ? "bg-emerald-500/85 text-white shadow-[0_0_18px_-4px_rgba(52,211,153,0.85)]"
                      : transcribing
                        ? "bg-amber-400/15 text-amber-200 animate-pulse"
                        : "bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/[0.10] border border-white/[0.08]"}`}
      >
        <MicIcon />
      </button>

      <button
        type="button"
        onClick={() => onSend()}
        disabled={!canSend}
        title="Plan Task — send current task when it has content"
        className={`absolute right-2.5 bottom-2.5 h-8 w-8 rounded-full flex items-center justify-center
                    transition-all
                    ${canSend
                      ? "bg-white text-black hover:bg-white/90 shadow-[0_0_18px_-4px_rgba(255,255,255,0.5)]"
                      : "bg-white/10 text-white/30 cursor-not-allowed"}
                    ${sending ? "animate-pulse" : ""}`}
      >
        <ArrowUpIcon />
      </button>
    </div>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}
function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2}>
      <line x1="12" y1="20" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  );
}
