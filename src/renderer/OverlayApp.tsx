import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import logoPuck from "./assets/logo.png";
import OverlayMiniChat from "./components/OverlayMiniChat";
import VmaxExpandedPanel from "./components/VmaxExpandedPanel";
import { useVoiceCapture } from "./hooks/useVoiceCapture";
import { useScreen } from "./hooks/useScreen";
import { subscribeSettingsUpdated } from "./utils/subscribeSettingsUpdated";
import { splitAgentsForPrompt } from "./utils/splitAgents";
import type { AgentStatusEvent, VmaxOverlayBroadcast, VmaxPanelPayload } from "./types";

/** Resize the pill window; prefers `overlay:set-bounds`, falls back if main predates that handler. */
async function syncOverlayShellBounds(width: number, height: number, animate: boolean): Promise<void> {
  const api = window.exec;
  if (typeof api.setOverlayBounds === "function") {
    try {
      await api.setOverlayBounds({ width, height, animate });
      return;
    } catch {
      /* Stale Electron without ipc handler — use legacy IPC */
    }
  }
  if (typeof api.setOverlayToolbarWidth === "function") {
    void api.setOverlayToolbarWidth(width);
  }
  void api.setOverlayContentHeight?.(height);
}

/** Must match `OVERLAY_PUCK_MIN` in electron/windows.js; outer drag frame size (see Puck). */
const OVERLAY_PUCK_PX = 80;

/** Bar → puck slide; keep in sync with CSS transition on the collapsing layer */
const MINIMIZE_TRANSITION_MS = 320;

function prefersOverlayReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Floating bar + expandable Vmax response (macOS vibrancy glass).
export default function OverlayApp() {
  const voice = useVoiceCapture();
  const screen = useScreen();
  const [status, setStatus] = useState<{ active?: boolean; busy?: boolean; screen?: boolean }>({});
  const [talkBack, setTalkBack] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPending, setChatPending] = useState(false);

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
  /** Collapses the toolbar to a tiny status puck (still floating). */
  const [minimized, setMinimized] = useState(false);
  const minimizedRef = useRef(false);
  minimizedRef.current = minimized;
  const shellRef = useRef<HTMLDivElement | null>(null);

  /** True while the toolbar is animating into the puck (minimize only). */
  const [minimizeLeaving, setMinimizeLeaving] = useState(false);
  /** After layout, flip so the puck layer can transition from hidden → visible. */
  const [puckReveal, setPuckReveal] = useState(false);

  /** Multiple concurrent exec:dispatch agents all emit running → done/error; track depth. */
  const dispatchBusyDepthRef = useRef(0);

  useEffect(() => {
    if (typeof window.exec.onAgentsStatus !== "function") return;
    return window.exec.onAgentsStatus((evt: AgentStatusEvent) => {
      if (evt.state === "running") {
        dispatchBusyDepthRef.current += 1;
        setDispatchBusy(true);
        setDispatchError(null);
      }
      if (evt.state === "done" || evt.state === "error") {
        dispatchBusyDepthRef.current = Math.max(0, dispatchBusyDepthRef.current - 1);
        if (evt.state === "error" && evt.error) setDispatchError(evt.error);
        if (dispatchBusyDepthRef.current === 0) setDispatchBusy(false);
      }
    });
  }, []);

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
    // Start screen capture once the user first opens chat (or invokes
    // voice). After it's started, we deliberately keep the stream alive
    // for the lifetime of the overlay window — calling stop() and start()
    // on every chat toggle re-runs getDisplayMedia, which can re-prompt
    // the user for permission. macOS grants the TCC prompt once; this
    // keeps the underlying MediaStream we already negotiated.
    if (chatOpen) void screen.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- useScreen methods are stable enough per mount
  }, [chatOpen]);

  useEffect(() => {
    // Release the stream when the overlay window unmounts.
    return () => screen.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on unmount
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
      // Fan-out: ask the backend splitter to decompose into 1–3 concurrent
      // jobs (one per agent). If it returns ≥2, dispatch them in parallel;
      // otherwise fall back to the heuristic single-agent router so trivial
      // prompts don't pay the multi-agent tax.
      if (typeof window.exec.dispatch === "function") {
        let splits: Awaited<ReturnType<typeof splitAgentsForPrompt>> = [];
        try {
          splits = await splitAgentsForPrompt(clean);
        } catch (err) {
          console.warn("split-agents failed; falling back to single-agent dispatch", err);
        }
        const res =
          splits.length >= 2
            ? await window.exec.dispatch({ agentPrompts: splits })
            : await window.exec.dispatch({ prompt: clean });
        if (!res?.ok && res?.error) setDispatchError(res.error);
      } else {
        await window.exec.pillVoiceQuestion(clean);
      }
    } catch (err) {
      console.error("voice failed", err);
      setDispatchError(String((err as Error)?.message || err));
    }
  }

  async function focusCC() {
    await window.exec.focusCommandCenter();
  }
  async function openSettings() {
    await window.exec.focusCommandCenter({ view: "settings" });
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
    voice.state === "finalizing" ||
    voice.state === "listening" ||
    !!status.busy ||
    dispatchBusy ||
    chatPending;

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

  useEffect(() => {
    if (showVmaxBody) void window.exec.setOverlayExpanded?.(true);
    else void window.exec.setOverlayExpanded?.(false);
  }, [showVmaxBody]);

  /** Shrink the native window to puck size (no tween) so vibrancy never shows a wide strip. */
  useEffect(() => {
    if (minimized) {
      void syncOverlayShellBounds(OVERLAY_PUCK_PX, OVERLAY_PUCK_PX, false);
    } else {
      void syncOverlayShellBounds(400, 56, true);
    }
  }, [minimized]);

  /** After minimize, size the native window from the puck shell (measured). */
  useLayoutEffect(() => {
    if (!minimized) return;
    const id = requestAnimationFrame(() => {
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const w = Math.ceil(Math.max(rect.width, shell.scrollWidth));
      const h = Math.ceil(Math.max(rect.height, shell.scrollHeight));
      if (w > 0 && h > 0) void syncOverlayShellBounds(w, h, false);
    });
    return () => cancelAnimationFrame(id);
  }, [minimized]);

  /** Native window tracks shell height (toolbar + optional chat + Vmax body). */
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      if (minimizedRef.current) {
        const shell = shellRef.current;
        if (shell) {
          const rect = shell.getBoundingClientRect();
          const w = Math.ceil(Math.max(rect.width, shell.scrollWidth));
          const h = Math.ceil(Math.max(rect.height, shell.scrollHeight));
          if (w > 0 && h > 0) {
            void syncOverlayShellBounds(w, h, false);
            return;
          }
        }
        void syncOverlayShellBounds(OVERLAY_PUCK_PX, OVERLAY_PUCK_PX, false);
        return;
      }
      const rect = el.getBoundingClientRect();
      const w = Math.ceil(Math.max(rect.width, el.scrollWidth));
      const h = Math.ceil(Math.max(rect.height, el.scrollHeight));
      void syncOverlayShellBounds(w, h, false);
    };
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(apply, 40);
    });
    ro.observe(el);
    apply();
    const again = window.setTimeout(apply, 100);
    return () => {
      if (t) clearTimeout(t);
      window.clearTimeout(again);
      ro.disconnect();
    };
  }, []);

  const beginMinimize = () => {
    if (prefersOverlayReducedMotion()) {
      setMinimized(true);
      return;
    }
    if (minimizeLeaving) return;
    setPuckReveal(false);
    setMinimizeLeaving(true);
  };

  useLayoutEffect(() => {
    if (!minimizeLeaving) return;
    setPuckReveal(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPuckReveal(true));
    });
    return () => cancelAnimationFrame(id);
  }, [minimizeLeaving]);

  useEffect(() => {
    if (!minimizeLeaving) return;
    const id = window.setTimeout(() => {
      setMinimized(true);
      setMinimizeLeaving(false);
      setPuckReveal(false);
    }, MINIMIZE_TRANSITION_MS);
    return () => window.clearTimeout(id);
  }, [minimizeLeaving]);

  return (
    <div
      className={`h-full w-max max-w-[100vw] flex flex-col overflow-x-visible overflow-y-hidden select-none
                  ${busy ? "shimmer-sweep" : ""}`}
    >
      <div
        ref={shellRef}
        className="grid [grid-template-areas:stack] shrink-0 w-max min-h-0 min-w-0"
      >
      {(!minimized || minimizeLeaving) && (
      <div
        className={`[grid-area:stack] col-start-1 row-start-1 row-end-[-1] w-max flex flex-col min-h-0 transition-all ease-out motion-reduce:!transition-none duration-[320ms] ${
          minimizeLeaving
            ? "translate-x-9 opacity-0 scale-[0.96] pointer-events-none [transition-timing-function:cubic-bezier(0.25,0.82,0.25,1)]"
            : "translate-x-0 opacity-100 scale-100 [transition-timing-function:cubic-bezier(0.25,0.82,0.25,1)]"
        }`}
      >
      <div
        className="shrink-0 flex flex-nowrap w-max box-border items-center gap-3 px-3 py-2 min-h-[56px]"
      >
        <div
          className="drag h-10 pl-1 pr-2 flex items-center cursor-grab active:cursor-grabbing
                     hover:bg-white/[0.08] rounded-full transition-colors shrink-0"
          title="Drag to move"
        >
          <DragGrip />
        </div>

        <button
          onClick={focusCC}
          title="Open Command Center"
          className="no-drag flex items-center gap-2 pl-1.5 pr-2.5 h-10 rounded-full hover:bg-white/[0.08] transition-colors shrink-0"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotTone}`} />
          <span className="text-[12.5px] font-semibold tracking-tight text-white drop-shadow whitespace-nowrap">Vmax</span>
        </button>

        <Divider />


        <button
          title={voice.state === "listening" ? "Listening… (click to cancel)" : "Ask a voice question"}
          onClick={handleVoice}
          className={`no-drag h-10 w-10 rounded-full flex items-center justify-center transition-all active:scale-[0.94] shrink-0 ${
            voice.state === "listening"
              ? "bg-emerald-500/90 text-white shadow-[0_0_22px_-3px_rgba(52,211,153,0.95)]"
              : voice.state === "finalizing"
                ? "bg-amber-400/30 text-amber-100 animate-pulse border border-amber-400/40"
                : "bg-sky-500/85 text-white hover:bg-sky-500 shadow-[0_0_18px_-4px_rgba(56,189,248,0.85)]"
          }`}
        >
          <MicIcon level={voice.level} listening={voice.state === "listening"} />
        </button>

        {/* Text chat — sibling to mic, distinct rose tint so the two
            input modes are obviously different colors. */}
        <button
          title={chatOpen ? "Hide chat" : "Text chat"}
          onClick={() => setChatOpen((o) => !o)}
          className={`no-drag h-10 w-10 rounded-full flex items-center justify-center transition-all active:scale-[0.94] shrink-0 ${
            chatOpen
              ? "bg-rose-500/95 text-white shadow-[0_0_22px_-3px_rgba(244,63,94,0.95)]"
              : "bg-rose-500/85 text-white hover:bg-rose-500 shadow-[0_0_18px_-4px_rgba(244,63,94,0.85)]"
          }`}
        >
          <ChatIcon />
        </button>

        <Divider />

        <div className="flex items-center gap-2 shrink-0">
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

        <PillButton
          title="Minimize to puck"
          onClick={beginMinimize}
          state="idle"
          activeBg="bg-white text-black"
        >
          <MinimizeIcon />
        </PillButton>
        </div>

        {canReopenPanel ? (
          <button
            type="button"
            title="Show last Vmax answer"
            onClick={() => void reopenResponseSurface()}
            className="no-drag h-10 w-10 rounded-full flex items-center justify-center transition-all active:scale-[0.94]
                       bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/35 text-emerald-100"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 15l6-6 6 6" />
            </svg>
          </button>
        ) : null}

        {speaking ? (
          <>
            <Divider />
            <span className="no-drag text-[10.5px] text-cyan-100/80 whitespace-nowrap font-medium tracking-tight animate-pulse px-0.5">
              Speaking…
            </span>
            <button
              type="button"
              title="Stop speaking"
              onClick={() => void stopSpeaking()}
              className="no-drag shrink-0 h-9 px-3 rounded-full text-[11px] font-medium
                         bg-white/14 hover:bg-white/22 border border-white/18 text-white/95"
            >
              Stop
            </button>
          </>
        ) : null}
      </div>

      <div
        className={`flex flex-col min-h-0 min-w-0 ${
          chatOpen || showVmaxBody ? "w-[560px] max-w-[560px]" : ""
        }`}
      >
        <OverlayMiniChat
          talkBack={talkBack}
          getScreenshot={() => screen.getLatestFrame()}
          open={chatOpen}
          onOpenChange={setChatOpen}
          onPendingChange={setChatPending}
        />

        {dispatchError && !showVmaxBody ? (
          <div className="no-drag px-4 pb-2 -mt-1 text-[10.5px] text-rose-200/85 truncate">
            {dispatchError}
          </div>
        ) : null}

        {showVmaxBody ? (
          <div className="no-drag flex flex-col px-2 pb-2 pt-0 w-full min-w-0">
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
      </div>
      )}
      {(minimized || minimizeLeaving) && (
        <div
          className={`[grid-area:stack] col-start-1 row-start-1 self-start z-30 flex h-[80px] w-[80px] items-center transition-all ease-out motion-reduce:!transition-none duration-[320ms] ${
            minimizeLeaving && !puckReveal
              ? "opacity-0 -translate-x-3 scale-[0.88] [transition-timing-function:cubic-bezier(0.25,0.82,0.25,1)]"
              : "opacity-100 translate-x-0 scale-100 [transition-timing-function:cubic-bezier(0.25,0.82,0.25,1)]"
          }`}
        >
          <Puck onRestore={() => setMinimized(false)} />
        </div>
      )}
      </div>
    </div>
  );
}

function Divider() {
  return <span className="w-px h-7 bg-white/15 shrink-0 self-center" aria-hidden />;
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
      className={`no-drag h-10 w-10 rounded-full flex items-center justify-center transition-all active:scale-[0.94] ${cls}`}
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
function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6v6" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-3H5a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4z" />
    </svg>
  );
}

function MinimizeIcon() {
  // Down-chevron in a square — reads as "collapse / put away" at 15×15.
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 11l4 4 4-4" />
    </svg>
  );
}

/** Minimized: fixed-size puck; native window size follows shell (see ResizeObserver). Logo tap restores. */
function Puck({ onRestore }: { onRestore: () => void }) {
  return (
    <div
      className="drag flex h-[80px] w-[80px] shrink-0 cursor-grab active:cursor-grabbing items-center justify-center overflow-hidden rounded-full bg-transparent"
      title="Drag outside the logo to move · Tap the logo to restore"
    >
      <button
        type="button"
        onClick={onRestore}
        title="Restore toolbar"
        className="no-drag relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 shadow-none outline-none
                   transition-transform active:scale-95"
      >
        <img
          src={logoPuck}
          alt=""
          className="max-h-[40px] max-w-[40px] h-auto w-auto object-contain pointer-events-none select-none"
          style={{
            filter: "brightness(1.22) contrast(1.08) saturate(1.05)",
          }}
          draggable={false}
          decoding="async"
        />
      </button>
    </div>
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
