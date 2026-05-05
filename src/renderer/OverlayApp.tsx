import React, { useEffect, useState } from "react";
import { useVoiceCapture } from "./hooks/useVoiceCapture";

// Pill-sized window (~460x64) using macOS native vibrancy. The whole window
// is the glass material — body fills it edge to edge — so we don't need a
// dark fill; the OS material paints the right tint over whatever is behind.

export default function OverlayApp() {
  const voice = useVoiceCapture();
  const [status, setStatus] = useState<{ active?: boolean; busy?: boolean; screen?: boolean }>({});
  const screenOn = !!status.screen;
  useEffect(() => {
    const off = window.exec.onWorkspaceStatus((s) => setStatus((prev) => ({ ...prev, ...s })));
    return () => off();
  }, []);

  async function handleVoice() {
    if (voice.state !== "idle") { voice.cancel(); return; }
    const result = await voice.start({ silenceMs: 1200, maxMs: 15000, threshold: 0.025 });
    if (!result) return;
    try {
      const { text } = await window.exec.transcribe(result);
      const clean = (text || "").trim();
      if (clean) await window.exec.pillVoiceQuestion(clean);
    } catch (err) {
      console.error("voice failed", err);
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

  const busy =
    voice.state === "finalizing" || voice.state === "listening" || !!status.busy;

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

  return (
    <div
      className={`flex w-full h-full items-center px-2 gap-2 overflow-hidden select-none
                  rounded-[20px] ring-1 ring-white/15 ring-inset
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]
                  ${busy ? "shimmer-sweep" : ""}`}
    >
        {/* Drag handle */}
        <div
          className="drag h-10 px-2 flex items-center cursor-grab active:cursor-grabbing
                     hover:bg-white/[0.08] rounded-full transition-colors"
          title="Drag to move"
        >
          <DragGrip />
        </div>

        {/* Brand / focus command center */}
        <button
          onClick={focusCC}
          title="Open Command Center"
          className="no-drag flex items-center gap-2 pl-1 pr-2 h-10 rounded-full hover:bg-white/[0.08] transition-colors"
        >
          <span className={`w-2 h-2 rounded-full ${dotTone}`} />
          <span className="text-[12.5px] font-semibold tracking-tight text-white drop-shadow">Exec</span>
        </button>

        <Divider />

        <PillButton
          title={voice.state === "listening" ? "Listening… (click to cancel)" : "Ask a voice question"}
          onClick={handleVoice}
          state={voice.state === "listening" ? "active" : voice.state === "finalizing" ? "busy" : "idle"}
          activeBg="bg-emerald-500/85 text-white shadow-[0_0_22px_-3px_rgba(52,211,153,0.95)]"
        >
          <MicIcon level={voice.level} listening={voice.state === "listening"} />
        </PillButton>

        <PillButton
          title={screenOn ? "Stop screen sharing" : "Share your screen"}
          onClick={toggleScreen}
          state={screenOn ? "active" : "idle"}
          activeBg="bg-rose-500/85 text-white shadow-[0_0_22px_-3px_rgba(244,63,94,0.95)]"
        >
          <ScreenIcon recording={screenOn} />
        </PillButton>

      <PillButton
        title="Send latest plan to Cursor"
        onClick={fireCursor}
        state="idle"
        activeBg="bg-white text-black"
      >
        <CursorIcon />
      </PillButton>
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
        : "bg-white/[0.08] text-white/85 hover:text-white hover:bg-white/[0.14] border border-white/[0.10]";
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
