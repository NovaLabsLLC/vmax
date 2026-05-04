import React, { useEffect, useState } from "react";
import HomePanel from "./panels/HomePanel";
import ProfilePanel from "./panels/ProfilePanel";
import SettingsPanel from "./panels/SettingsPanel";
import HelpPanel from "./panels/HelpPanel";
import Onboarding from "./onboarding/Onboarding";

type View = "home" | "profile" | "settings" | "help";

export default function CommandCenter() {
  const [view, setView] = useState<View>("home");
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [profileName, setProfileName] = useState<string>("");

  useEffect(() => {
    (async () => {
      setOnboarded(await window.exec.isOnboarded());
      const p = await window.exec.getProfile();
      if (p?.name) setProfileName(p.name);
    })();
  }, []);

  if (onboarded === null) return null;
  if (!onboarded) {
    return (
      <Onboarding
        onDone={async () => {
          setOnboarded(true);
          const p = await window.exec.getProfile();
          if (p?.name) setProfileName(p.name);
        }}
      />
    );
  }

  return (
    <div className="h-full flex bg-[#08080a] text-[#e6e6ea]">
      <Sidebar
        view={view}
        onView={setView}
        profileName={profileName}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="drag h-11 shrink-0 border-b border-white/[0.05]" />
        <div className="flex-1 overflow-y-auto">
          {view === "home" && <HomePanel profileName={profileName} onGoSettings={() => setView("settings")} />}
          {view === "profile" && <ProfilePanel onSaved={(p) => setProfileName(p.name || "")} />}
          {view === "settings" && <SettingsPanel />}
          {view === "help" && <HelpPanel />}
        </div>
      </main>
    </div>
  );
}

function Sidebar({
  view,
  onView,
  profileName,
}: {
  view: View;
  onView: (v: View) => void;
  profileName: string;
}) {
  return (
    <aside className="w-[200px] shrink-0 border-r border-white/[0.05] bg-[#0a0a0c] flex flex-col">
      {/* Spacer for traffic lights */}
      <div className="drag h-11 shrink-0 flex items-center pl-[76px] pr-3">
        <div className="text-[12.5px] font-semibold tracking-tight text-white/85">Exec</div>
      </div>

      <nav className="px-2 py-2 space-y-0.5">
        <NavItem icon={<HomeIcon />} label="Home" active={view === "home"} onClick={() => onView("home")} />
        <NavItem icon={<UserIcon />} label="Profile" active={view === "profile"} onClick={() => onView("profile")} />
        <NavItem icon={<GearIcon />} label="Settings" active={view === "settings"} onClick={() => onView("settings")} />
        <NavItem icon={<HelpIcon />} label="Help" active={view === "help"} onClick={() => onView("help")} />
      </nav>

      <div className="mt-auto p-2">
        <button
          onClick={() => onView("profile")}
          className="w-full flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/[0.04] transition-colors"
        >
          <Avatar name={profileName} />
          <div className="min-w-0 text-left">
            <div className="text-[12px] text-white truncate">{profileName || "Set up profile"}</div>
            <div className="text-[10px] text-white/40">Account</div>
          </div>
        </button>
      </div>
    </aside>
  );
}

function NavItem({
  icon, label, active, onClick,
}: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] tracking-tight transition-colors
        ${active
          ? "bg-white/[0.07] text-white"
          : "text-white/65 hover:text-white hover:bg-white/[0.04]"}`}
    >
      <span className={active ? "text-white" : "text-white/55"}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = (name || "?").split(/\s+/).slice(0, 2).map((s) => s[0] || "").join("").toUpperCase() || "?";
  return (
    <div className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center text-[10.5px] font-bold shrink-0">
      {initials}
    </div>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function HomeIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}><path d="M3 12 12 4l9 8" /><path d="M5 10v10h14V10" /></svg>;
}
function UserIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
}
function GearIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
}
function HelpIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></svg>;
}
