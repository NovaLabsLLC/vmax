import React, { useEffect, useRef, useState } from "react";
import { useVoiceCapture } from "./hooks/useVoiceCapture";
import { subscribeSettingsUpdated } from "./utils/subscribeSettingsUpdated";
import VmaxExpandedPanel from "./components/VmaxExpandedPanel";
import type { AgentStatusEvent, ExecAgent, VmaxOverlayBroadcast, VmaxPanelPayload } from "./types";

// Floating bar + expandable Vmax response (macOS vibrancy glass).
export default function OverlayApp() {
  const voice = useVoiceCapture();
  const [status, setStatus] = useState<{ active?: boolean; busy?: boolean; screen?: boolean }>({});
  const [talkBack, setTalkBack] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const screenOn = !!status.screen;

  const [vmaxUi, setVmaxUi] = useState<{
    phase: "idle" | "loading" | "ready" | "error";
    question: string;
    panel: VmaxPanelPayload | null;
    parseWarning?: boolean;
    errorMsg?: string;
  }>({ phase: "idle", question: "", panel: null });

  /** Window is tall enough to show the response surface */
  const [surfaceExpanded, setSurfaceExpanded] = useState(false);

  // Backend-only routing — the bar doesn't show which agent ran. We still
  // listen for agents:status so we can surface dispatch errors inline (and
  // toggle the pill's busy shimmer while a dispatch is in flight).
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window.exec.onAgentsStatus !== "function") return;
    return window.exec.onAgentsStatus((evt: AgentStatusEvent) => {
      if (evt.state === "running") { setDispatchBusy(true); setDispatchError(null); }
      if (evt.state === "done") setDispatchBusy(false);
      if (evt.state === "error") {
        setDispatchBusy(false);
        if (evt.error) setDispatchError(evt.error);
      }
    });
  }, []);

  // Wrapper around the response body. We measure its rendered height each phase
  // change and push it to the main process so the overlay window hugs whatever
  // content is currently visible — loading skeleton, error box, or full panel.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !surfaceExpanded) return;
    const push = () => {
      const h = Math.ceil(el.getBoundingClientRect().height) + 64; // + pill row
      window.exec.setOverlayContentHeight?.(h);
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => ro.disconnect();
  }, [surfaceExpanded, vmaxUi.phase, vmaxUi.panel]);

  useEffect(() => {
    const off = window.exec.onWorkspaceStatus((s) => setStatus((prev) => ({ ...prev, ...s })));
    return () => off();
  }, []);

  useEffect(() => {
    void window.exec.getSettings().then((s) => setTalkBack(s.talkBack !== false));
  }, []);

  useEffect(() => {
    return subscribeSettingsUpdated((sett) => {
      if (typeof sett.talkBack === "boolean") setTalkBack(sett.talkBack);
    });
  }, []);

  useEffect(() => {
    const off = window.exec.onWorkspaceSpeaking((s) => setSpeaking(!!s));
    return () => off();
  }, []);

  useEffect(() => {
    const sub = window.exec.onVmaxResponse;
    if (typeof sub !== "function") return () => {};
    return sub((msg: VmaxOverlayBroadcast) => {
      if (msg.phase === "loading") {
        // Wipe everything from the previous turn so we never flash a stale
        // answer beneath the loading skeleton.
        setVmaxUi({
          phase: "loading",
          question: msg.question || "",
          panel: null,
          parseWarning: false,
          errorMsg: undefined,
        });
        setSurfaceExpanded(true);
        void window.exec.setOverlayExpanded?.(true);
      }
      if (msg.phase === "ready") {
        setVmaxUi({
          phase: "ready",
          question: msg.question,
          panel: msg.panel,
          parseWarning: msg.parseWarning,
          errorMsg: undefined,
        });
        setSurfaceExpanded(true);
      }
      if (msg.phase === "error") {
        setVmaxUi((prev) => ({
          phase: "error",
          question: prev.question,
          panel: null,
          errorMsg: msg.message,
        }));
        setSurfaceExpanded(true);
      }
    });
  }, []);

  useEffect(() => {
    let stopWatcher: (() => void) | null = null;
    const off = window.exec.onWorkspaceSpeaking(async (isSpeaking) => {
      if (stopWatcher) { stopWatcher(); stopWatcher = null; }
      if (!isSpeaking) return;
      if (voice.state !== "idle") return;
      try {
        stopWatcher = await voice.watchForSpeech(async () => {
          if (stopWatcher) { stopWatcher(); stopWatcher = null; }
          try { await window.exec.pillInterruptSpeech(); } catch { /* noop */ }
          handleVoice();
        }, { threshold: 0.06, minMs: 220 });
      } catch (err) {
        console.error("barge-in watcher failed", err);
      }
    });
    return () => {
      off();
      if (stopWatcher) stopWatcher();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.state]);

  async function handleVoice() {
    if (voice.state !== "idle") { voice.cancel(); return; }
    try { await window.exec.pillInterruptSpeech(); } catch { /* noop */ }
    const result = await voice.start({ silenceMs: 1200, maxMs: 15000, threshold: 0.025 });
    if (!result) return;
    try {
      const { text } = await window.exec.transcribe(result);
      const clean = (text || "").trim();
      if (!clean) return;
      // Direct route: Exec picks the best coding agent and fires it.
      // Status chips update via onAgentsStatus.
      if (typeof window.exec.dispatch === "function") {
        const res = await window.exec.dispatch({ prompt: clean });
        if (!res?.ok && res?.error) setDispatchError(res.error);
      } else {
        await window.exec.pillVoiceQuestion(clean);
      }
    } catch (err) {
      console.error("voice failed", err);
      setDispatchError(String((err as Error)?.message || err));
    }
  }

  async function toggleScreen() {
    await window.exec.pillToggleScreen();
  }
  async function fireCursor() {
    await window.exec.pillRequestCursor();
  }
  async function focusCC() {
    await window.exec.focusCommandCenter();
  }
  async function openSettings() {
    await window.exec.focusCommandCenter({ view: "settings" });
  }

  async function toggleTalkBack() {
    const next = !talkBack;
    setTalkBack(next);
    try {
      await window.exec.saveSettings({ talkBack: next });
    } catch {
      setTalkBack(!next);
    }
  }

  async function stopSpeaking() {
    try {
      await window.exec.pillInterruptSpeech();
    } catch {
      /* noop */
    }
  }

  async function collapseResponseSurface() {
    setSurfaceExpanded(false);
    if (typeof window.exec.setOverlayExpanded === "function") {
      await window.exec.setOverlayExpanded(false);
    }
  }

  async function reopenResponseSurface() {
    setSurfaceExpanded(true);
    if (typeof window.exec.setOverlayExpanded === "function") {
      await window.exec.setOverlayExpanded(true);
    }
  }

  function pushPanelAction(action: Parameters<typeof window.exec.vmaxPanelAction>[0]) {
    if (typeof window.exec.vmaxPanelAction !== "function") return;
    void window.exec.vmaxPanelAction(action);
  }

  const busy =
    voice.state === "finalizing" || voice.state === "listening" || !!status.busy || dispatchBusy;

  const dotTone =
    voice.state === "listening"
      ? "bg-emerald-400 animate-pulse"
      : voice.state === "finalizing"
        ? "bg-amber-400 animate-pulse"
        : status.busy
          ? "bg-amber-400 animate-pulse"
          : status.active
            ? "bg-emerald-400"
            : "bg-white/55";

  const showVmaxBody = surfaceExpanded && (vmaxUi.phase === "loading" || vmaxUi.phase === "ready" || vmaxUi.phase === "error");
  const canReopenPanel = !surfaceExpanded && vmaxUi.phase === "ready" && vmaxUi.panel;

  return (
    <div
      className={`h-full flex flex-col overflow-hidden select-none
                  ${busy ? "shimmer-sweep" : ""}`}
    >
      <div className="shrink-0 flex w-full items-center px-1.5 gap-1.5 overflow-hidden min-h-[56px]">
        <div
          className="drag h-9 px-1.5 flex items-center cursor-grab active:cursor-grabbing
                     hover:bg-white/[0.08] rounded-full transition-colors"
          title="Drag to move"
        >
          <DragGrip />
        </div>

        <button
          onClick={focusCC}
          title="Open Command Center"
          className="no-drag flex items-center gap-1.5 pl-1 pr-1.5 h-9 rounded-full hover:bg-white/[0.08] transition-colors shrink-0"
        >
          <span className={`w-2 h-2 rounded-full ${dotTone}`} />
          <span className="text-[12px] font-semibold tracking-tight text-white drop-shadow">Exec</span>
        </button>

        <Divider />


        <button
          title={voice.state === "listening" ? "Listening… (click to cancel)" : "Ask a voice question"}
          onClick={handleVoice}
          className={`no-drag h-9 w-9 rounded-full flex items-center justify-center transition-all active:scale-[0.94] shrink-0 ${
            voice.state === "listening"
              ? "bg-emerald-500/90 text-white shadow-[0_0_22px_-3px_rgba(52,211,153,0.95)]"
              : voice.state === "finalizing"
                ? "bg-amber-400/30 text-amber-100 animate-pulse border border-amber-400/40"
                : "bg-sky-500/85 text-white hover:bg-sky-500 shadow-[0_0_18px_-4px_rgba(56,189,248,0.85)]"
          }`}
        >
          <MicIcon level={voice.level} listening={voice.state === "listening"} />
        </button>

        <Divider />

        <PillButton
          title="Set API keys"
          onClick={() => void openSettings()}
          state="idle"
          activeBg="bg-white text-black"
        >
          <GearIcon />
        </PillButton>

        <PillButton
          title="Open Command Center"
          onClick={() => void focusCC()}
          state="idle"
          activeBg="bg-white text-black"
        >
          <ExpandIcon />
        </PillButton>

        {canReopenPanel ? (
          <button
            type="button"
            title="Show last Vmax answer"
            onClick={() => void reopenResponseSurface()}
            className="no-drag h-9 w-9 rounded-full flex items-center justify-center transition-all active:scale-[0.94]
                       bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/35 text-emerald-100"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 15l6-6 6 6" />
            </svg>
          </button>
        ) : null}

        {speaking ? (
          <>
            <span className="no-drag text-[10px] text-cyan-100/80 whitespace-nowrap font-medium tracking-tight animate-pulse">
              Speaking…
            </span>
            <button
              type="button"
              title="Stop speaking"
              onClick={() => void stopSpeaking()}
              className="no-drag shrink-0 h-8 px-2.5 rounded-full text-[10.5px] font-medium
                         bg-white/14 hover:bg-white/22 border border-white/18 text-white/95"
            >
              Stop
            </button>
          </>
        ) : null}
      </div>

      {dispatchError && !showVmaxBody ? (
        <div className="no-drag px-4 pb-2 -mt-1 text-[10.5px] text-rose-200/85 truncate">
          {dispatchError}
        </div>
      ) : null}

      {showVmaxBody ? (
        <div ref={bodyRef} className="no-drag flex flex-col px-2 pb-2 pt-0">
          {vmaxUi.phase === "loading" ? (
            <div className="rounded-[16px] border border-white/[0.1] bg-black/[0.2] p-3 space-y-2 animate-pulse">
              <div className="h-3 rounded bg-white/[0.12] w-1/4" />
              <div className="h-3 rounded bg-white/[0.06] w-3/4" />
              <div className="h-3 rounded bg-white/[0.06] w-2/3" />
              <div className="h-3 rounded bg-white/[0.06] w-1/2" />
            </div>
          ) : null}

          {vmaxUi.phase === "error" ? (
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/[0.08] px-3 py-2 text-[12px] text-rose-100/90">
              {vmaxUi.errorMsg || "Something went wrong."}
            </div>
          ) : null}

          {vmaxUi.phase === "ready" && vmaxUi.panel ? (
            <VmaxExpandedPanel
              question={vmaxUi.question}
              panel={vmaxUi.panel}
              parseWarning={vmaxUi.parseWarning}
              onCollapse={() => void collapseResponseSurface()}
              onCopyCursor={() => void window.exec.copy(vmaxUi.panel!.cursorPrompt || "")}
              onSendClaude={() => pushPanelAction({ type: "run-claude", prompt: vmaxUi.panel!.claudePrompt || vmaxUi.panel!.cursorPrompt })}
              onSendCursor={() => pushPanelAction({ type: "send-cursor", prompt: vmaxUi.panel!.cursorPrompt || vmaxUi.panel!.claudePrompt || "" })}
              onOpenClaw={() =>
                pushPanelAction({
                  type: "openclaw",
                  question: vmaxUi.question,
                  panel: vmaxUi.panel!,
                })}
              onRunSafeCommand={(cmd) => pushPanelAction({ type: "run-command", command: cmd })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Divider() {
  return <span className="w-px h-6 bg-white/15 mx-0.5" />;
}

function PillButton({
  children,
  title,
  onClick,
  state,
  activeBg,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  state: "idle" | "active" | "busy";
  activeBg: string;
}) {
  const cls =
    state === "active"
      ? activeBg
      : state === "busy"
        ? "bg-amber-400/15 text-amber-100 animate-pulse border border-amber-400/30"
        : "bg-white/[0.16] text-white/95 hover:text-white hover:bg-white/[0.24] border border-white/[0.22]";
  return (
    <button
      title={title}
      onClick={onClick}
      className={`no-drag h-9 w-9 rounded-full flex items-center justify-center transition-all active:scale-[0.94] ${cls}`}
    >
      {children}
    </button>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function DragGrip() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
      {[2, 6].map((cx) =>
        [3, 7, 11].map((cy) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" fill="currentColor" className="text-white/45" />
        ))
      )}
    </svg>
  );
}
function MicIcon({ level, listening }: { level: number; listening: boolean }) {
  const scale = listening ? 1 + Math.min(0.25, level * 0.5) : 1;
  return (
    <div className="relative" style={{ transform: `scale(${scale})`, transition: "transform 80ms" }}>
      <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <line x1="12" y1="18" x2="12" y2="22" />
      </svg>
    </div>
  );
}
function ScreenIcon({ recording }: { recording: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      {recording && <circle cx="12" cy="11" r="2.5" fill="currentColor" stroke="none" />}
    </svg>
  );
}
function CursorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6v6" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <path d="M12 6 7 9H4v6h3l5 3V6Z" />
      {on ? (
        <>
          <path d="M16 9a4 4 0 0 1 0 6" className="opacity-95" />
          <path d="M17.5 7a7 7 0 0 1 0 10" className="opacity-70" />
        </>
      ) : (
        <line x1="17" y1="7" x2="11" y2="17" />
      )}
    </svg>
  );
}
