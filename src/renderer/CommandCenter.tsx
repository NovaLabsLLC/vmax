import React, { useEffect, useState } from "react";
import AgentsPanel from "./panels/AgentsPanel";
import SettingsPanel from "./panels/SettingsPanel";
import Onboarding from "./onboarding/Onboarding";

type CcPage = "settings" | "agents";

export default function CommandCenter() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [page, setPage] = useState<CcPage>("settings");

  useEffect(() => {
    (async () => {
      setOnboarded(await window.exec.isOnboarded());
    })();
  }, []);

  useEffect(() => {
    const off = window.exec.onCcNavigate((p) => {
      const v = p?.view;
      if (v === "agents") setPage("agents");
      else if (v === "settings" || v === "home" || v === "workspace" || v === "chats" || v === "profile" || v === "help") {
        setPage("settings");
      }
    });
    return () => off();
  }, []);

  if (onboarded === null) return null;
  if (!onboarded) {
    return <Onboarding onDone={() => setOnboarded(true)} />;
  }

  const title = page === "agents" ? "Agents" : "Settings";

  return (
    <div className="h-full flex flex-col bg-[#08080a] text-[#e6e6ea]">
      <div className="drag h-11 shrink-0 border-b border-white/[0.05] flex items-center pl-[80px] pr-3 gap-3">
        <div className="text-[12.5px] font-semibold tracking-tight text-white/85 truncate min-w-0">
          Vmax · {title}
        </div>
        <nav className="no-drag flex items-center gap-1 ml-1">
          <NavPill active={page === "settings"} onClick={() => setPage("settings")}>
            Settings
          </NavPill>
          <NavPill active={page === "agents"} onClick={() => setPage("agents")}>
            Agents
          </NavPill>
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto">
        {page === "settings" ? <SettingsPanel /> : <AgentsPanel onGoSettings={() => setPage("settings")} />}
      </div>
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
