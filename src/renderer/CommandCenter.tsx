import React, { useEffect, useState } from "react";
import SettingsPanel from "./panels/SettingsPanel";
import Onboarding from "./onboarding/Onboarding";

// The Command Center is now a single-purpose Settings window. The pill is the
// primary UI — this window only exists so the user has somewhere to drop API
// keys and complete onboarding. Voice IPC routing happens directly through
// the main process now, not via this renderer.
export default function CommandCenter() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      setOnboarded(await window.exec.isOnboarded());
    })();
  }, []);

  if (onboarded === null) return null;
  if (!onboarded) {
    return <Onboarding onDone={() => setOnboarded(true)} />;
  }

  return (
    <div className="h-full flex flex-col bg-[#08080a] text-[#e6e6ea]">
      <div className="drag h-11 shrink-0 border-b border-white/[0.05] flex items-center pl-[80px] pr-3">
        <div className="text-[12.5px] font-semibold tracking-tight text-white/85">Exec · Settings</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <SettingsPanel />
      </div>
    </div>
  );
}
