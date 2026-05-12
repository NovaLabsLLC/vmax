import React, { useEffect, useRef, useState } from "react";
import type { VmaxPanelAction } from "./types";
import SettingsPanel from "./panels/SettingsPanel";
import WorkspaceChatSidebar from "./components/WorkspaceChatSidebar";
import WorkspacePanel from "./panels/WorkspacePanel";
import Onboarding from "./onboarding/Onboarding";

type CcPage = "settings" | "workspace";

export default function CommandCenter() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [page, setPage] = useState<CcPage>("settings");

  /** Filled when Workspace mounts; cleared on unmount. Kept wired by leaving Workspace mounted (hidden tab). */
  const vmaxDispatcherRef = useRef<((action: VmaxPanelAction) => void) | null>(null);

  /** Voice routed from overlay → forwarded to Workspace Ask (epoch bumps effect). */
  const [voiceFromPill, setVoiceFromPill] = useState<{ text: string; epoch: number } | null>(null);
  /** Active Workspace chat persisted in exec-sessions.json; drives sidebar + hydration. */
  const [workspaceSessionId, setWorkspaceSessionId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setOnboarded(await window.exec.isOnboarded());
    })();
  }, []);

  useEffect(() => {
    const offNav = window.exec.onCcNavigate((p) => {
      const v = p?.view;
      if (v === "agents") setPage("workspace");
      else if (v === "workspace" || v === "home") setPage("workspace");
      else if (v === "settings" || v === "chats" || v === "profile" || v === "help") setPage("settings");
    });
    const offVm = window.exec.onVmaxPanelAction((action) => {
      setPage("workspace");
      window.setTimeout(() => vmaxDispatcherRef.current?.(action), 0);
    });
    const offVoice = window.exec.onPillVoiceQuestion((text) => {
      const t = String(text || "").trim();
      if (!t) return;
      setPage("workspace");
      setVoiceFromPill({ text: t, epoch: Date.now() });
    });
    return () => {
      offNav();
      offVm();
      offVoice();
    };
  }, []);

  if (onboarded === null) return null;
  if (!onboarded) {
    return <Onboarding onDone={() => setOnboarded(true)} />;
  }

  return (
    <div className="h-full flex flex-col min-h-0 min-w-0 bg-[#0c0c0f] text-white/[0.92] relative overflow-hidden">
      {/* Soft top light + subtle depth — keeps UI from feeling flat black. */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_55%_at_50%_-10%,rgba(255,255,255,0.09),transparent_55%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.03] via-transparent to-transparent"
        aria-hidden
      />


      <div className="flex-1 min-h-0 overflow-hidden relative z-10 pb-[5.25rem]">
        {/*
          Keep Workspace mounted while Command Center runs so vmax overlay handoffs and executor ref stay valid.
          Other tabs hide via invisible / inert wrappers.
        */}
        <div className={`h-full min-h-0 overflow-y-auto absolute inset-0 ${page !== "settings" ? "hidden" : ""}`}>
          <SettingsPanel />
        </div>
        <div className={`h-full min-h-0 absolute inset-0 flex flex-row min-w-0 ${page !== "workspace" ? "hidden" : ""}`}>
          <WorkspaceChatSidebar activeSessionId={workspaceSessionId} onActiveSessionChange={setWorkspaceSessionId} />
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
            <WorkspacePanel
              pendingVoiceQuestion={voiceFromPill}
              onConsumeVoiceQuestion={() => setVoiceFromPill(null)}
              activeSessionId={workspaceSessionId}
              onSessionChange={setWorkspaceSessionId}
              registerVmaxPanelExecutor={(dispatcher) => {
                vmaxDispatcherRef.current = dispatcher;
              }}
            />
          </div>
        </div>
      </div>

      {/* Floating nav — anchored to viewport, inset from edges; drag the capsule chrome to move the window. */}
      <div className="pointer-events-none absolute bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))] left-0 right-0 z-[60] flex justify-center px-6 sm:px-10">
        <div
          className="drag pointer-events-auto flex items-center gap-1 rounded-[999px] border border-white/[0.14]
                     bg-[#0c0c0f]/82 backdrop-blur-xl px-2 py-1.5 shadow-[0_12px_48px_-8px_rgba(0,0,0,0.75)]
                     ring-1 ring-white/[0.06]"
        >
          <nav className="no-drag flex items-center justify-center gap-1.5 flex-wrap">
            <NavPill active={page === "settings"} onClick={() => setPage("settings")}>
              Settings
            </NavPill>
            <NavPill active={page === "workspace"} onClick={() => setPage("workspace")}>
              Workspace
            </NavPill>
          </nav>
        </div>
      </div>
    </div>
  );
}

function NavPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-full text-[11.5px] font-medium transition-colors border shadow-sm ${
        active
          ? "bg-white text-black border-white shadow-[0_0_0_1px_rgba(255,255,255,0.4)]"
          : "bg-white/[0.06] text-white/[0.78] hover:text-white border-white/[0.12] hover:bg-white/[0.1]"
      }`}
    >
      {children}
    </button>
  );
}
