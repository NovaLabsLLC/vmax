import React, { useEffect, useRef, useState } from "react";
import { useAudio } from "../hooks/useAudio";

const HOLD_MS = 420; /* press longer than this = push-to-hold (release stops) */

type Props = {
  task: string;
  onTaskChange: (v: string) => void;
  onSend: () => void;
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
          ? "Microphone permission denied — you can still type your task."
          : "Couldn’t use the microphone — you can still type your task.";
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
      const msg = "Transcription failed — edit your task or try again.";
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
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/40">Task</div>
        <div className="text-[10px] text-white/30">
          Hold mic, tap to toggle, or type
        </div>
      </div>
      <textarea
        value={task}
        onChange={(e) => onTaskChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSend) {
            e.preventDefault();
            onSend();
          }
        }}
        disabled={disabled}
        placeholder={
          transcribing ? "Transcribing…"
          : micActive ? "Listening…"
          : "Add RevenueCat paywall flow"
        }
        rows={2}
        className="w-full bg-transparent outline-none border-none resize-none
                   text-[13px] text-white placeholder-white/30 leading-relaxed
                   focus:placeholder-white/40"
      />

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
        title="Hold to talk, or tap to start/stop recording"
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
        title="Plan Task (⌘ Enter)"
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
