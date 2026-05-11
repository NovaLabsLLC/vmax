import React, { useEffect, useRef, useState } from "react";
import type { VmaxPanelAction } from "./types";
import AgentsPanel from "./panels/AgentsPanel";
import SettingsPanel from "./panels/SettingsPanel";
import WorkspacePanel from "./panels/WorkspacePanel";
import Onboarding from "./onboarding/Onboarding";

type CcPage = "settings" | "agents" | "workspace";

export default function CommandCenter() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [page, setPage] = useState<CcPage>("settings");

  /** Filled when Workspace mounts; cleared on unmount. Kept wired by leaving Workspace mounted (hidden tab). */
  const vmaxDispatcherRef = useRef<((action: VmaxPanelAction) => void) | null>(null);

  /** Voice routed from overlay → forwarded to Workspace Ask (epoch bumps effect). */
  const [voiceFromPill, setVoiceFromPill] = useState<{ text: string; epoch: number } | null>(null);

  useEffect(() => {
    (async () => {
      setOnboarded(await window.exec.isOnboarded());
    })();
  }, []);

  useEffect(() => {
    const offNav = window.exec.onCcNavigate((p) => {
      const v = p?.view;
      if (v === "agents") setPage("agents");
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
    <div className="h-full flex flex-col min-h-0 bg-[#08080a] text-[#e6e6ea]">
      {/* hiddenInset title bar — drag strip only (traffic lights use the left inset). */}
      <div className="drag h-9 shrink-0 w-full" aria-hidden />

      <div className="flex-1 min-h-0 overflow-hidden relative">
        {/*
          Keep Workspace mounted while Command Center runs so vmax overlay handoffs and executor ref stay valid.
          Other tabs hide via invisible / inert wrappers.
        */}
        <div className={`h-full min-h-0 overflow-y-auto absolute inset-0 ${page !== "settings" ? "hidden" : ""}`}>
          <SettingsPanel />
        </div>
        <div className={`h-full min-h-0 overflow-y-auto absolute inset-0 ${page !== "agents" ? "hidden" : ""}`}>
          <AgentsPanel onGoSettings={() => setPage("settings")} />
        </div>
        <div className={`h-full min-h-0 overflow-y-auto absolute inset-0 ${page !== "workspace" ? "hidden" : ""}`}>
          <WorkspacePanel
            pendingVoiceQuestion={voiceFromPill}
            onConsumeVoiceQuestion={() => setVoiceFromPill(null)}
            registerVmaxPanelExecutor={(dispatcher) => {
              vmaxDispatcherRef.current = dispatcher;
            }}
          />
        </div>
      </div>

      <footer className="shrink-0 z-20 w-full flex justify-center border-t border-white/[0.08] bg-[#08080a] py-2.5 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
        <nav className="no-drag flex items-center justify-center gap-1.5 flex-wrap">
          <NavPill active={page === "settings"} onClick={() => setPage("settings")}>
            Settings
          </NavPill>
          <NavPill active={page === "agents"} onClick={() => setPage("agents")}>
            Agents
          </NavPill>
          <NavPill active={page === "workspace"} onClick={() => setPage("workspace")}>
            Workspace
          </NavPill>
        </nav>
      </footer>
    </div>
  );
}

function NavPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-full text-[11.5px] font-medium transition-colors border ${
        active
          ? "bg-white text-black border-white"
          : "bg-white/[0.04] text-white/65 hover:text-white/90 border-white/[0.08] hover:bg-white/[0.08]"
      }`}
    >
      {children}
    </button>
  );
}
