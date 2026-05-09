import React, { useEffect, useRef, useState } from "react";
import HomePanel from "./panels/HomePanel";
import WorkspacePanel from "./panels/WorkspacePanel";
import ChatsPanel from "./panels/ChatsPanel";
import ProfilePanel from "./panels/ProfilePanel";
import SettingsPanel from "./panels/SettingsPanel";
import HelpPanel from "./panels/HelpPanel";
import Onboarding from "./onboarding/Onboarding";
import RepoContextStrip from "./components/RepoContextStrip";
import { useScreen } from "./hooks/useScreen";
import type { VmaxPanelAction } from "./types";

type View = "home" | "workspace" | "chats" | "profile" | "settings" | "help";

export default function CommandCenter() {
  const [view, setView] = useState<View>("home");
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [profileName, setProfileName] = useState<string>("");
  // Voice question dispatched from the floating pill. Lifted up here so it's
  // captured even when the user is on a different tab (Workspace might be
  // unmounted otherwise).
  const [pendingVoiceQuestion, setPendingVoiceQuestion] = useState<{ text: string; epoch: number } | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const vmaxOverlayExecutorRef = useRef<((action: VmaxPanelAction) => void) | null>(null);
  const [savedRepoPath, setSavedRepoPath] = useState<string | null>(null);
  const [savedRepoName, setSavedRepoName] = useState<string | null>(null);
  const [repoSelectBusy, setRepoSelectBusy] = useState(false);
  const [savedRepoEpoch, setSavedRepoEpoch] = useState(0);
  const [repoListEpoch, setRepoListEpoch] = useState(0);
  const [sessionListEpoch, setSessionListEpoch] = useState(0);
  const [sidebarSessions, setSidebarSessions] = useState<{ id: string; title: string; updatedAt: number; repoName: string | null }[]>([]);

  async function refreshSidebarSessions() {
    try {
      const rows = await window.exec.listSessions();
      setSidebarSessions(rows.slice(0, 20));
    } catch {
      /* noop */
    }
  }
  useEffect(() => { void refreshSidebarSessions(); }, [sessionListEpoch]);
  useEffect(() => {
    if (typeof window.exec.onSessionsUpdated !== "function") return;
    return window.exec.onSessionsUpdated(() => {
      void refreshSidebarSessions();
    });
  }, []);

  // Start a new chat: optional repo to remember, optional question to seed.
  // Always opens the floating overlay so the user can talk to it right away.
  async function startNewChat(opts?: { repoPath?: string; question?: string }) {
    if (opts?.repoPath) {
      await window.exec.rememberRepo(opts.repoPath);
      setSavedRepoEpoch((e) => e + 1);
      setRepoListEpoch((e) => e + 1);
      void refreshSavedRepoDisplay();
    }
    const repoPath = opts?.repoPath || (await window.exec.getLastRepo()) || undefined;
    const session = await window.exec.newSession(repoPath ? { repoPath } : {});
    setActiveSessionId(session.id);
    setSessionListEpoch((e) => e + 1);
    setView("workspace");
    void window.exec.openOverlay();
    if (opts?.question && opts.question.trim()) {
      setPendingVoiceQuestion({ text: opts.question.trim(), epoch: Date.now() });
    }
  }

  async function openExistingChat(id: string) {
    setActiveSessionId(id);
    setView("workspace");
    void window.exec.openOverlay();
  }

  async function deleteSidebarChat(id: string) {
    await window.exec.deleteSession(id);
    if (activeSessionId === id) setActiveSessionId(null);
    setSessionListEpoch((e) => e + 1);
  }

  useEffect(() => {
    const sub = window.exec.onVmaxPanelAction;
    if (typeof sub !== "function") return () => {};
    return sub((action) => vmaxOverlayExecutorRef.current?.(action));
  }, []);

  // Screen capture lives here so the pill's toggle works no matter which tab
  // is open. The latest frame is passed down to the workspace.
  const screenCap = useScreen();

  async function refreshSavedRepoDisplay() {
    const p = await window.exec.getLastRepo();
    setSavedRepoPath(p);
    if (p) {
      const ctx = await window.exec.scanRepo(p);
      setSavedRepoName(ctx?.ok ? ctx.name : null);
    } else {
      setSavedRepoName(null);
    }
  }

  useEffect(() => {
    (async () => {
      setOnboarded(await window.exec.isOnboarded());
      const p = await window.exec.getProfile();
      if (p?.name) setProfileName(p.name);
      await refreshSavedRepoDisplay();
    })();
  }, []);

  async function handleSelectRepo() {
    setRepoSelectBusy(true);
    try {
      const p = await window.exec.pickRepo();
      if (!p) return;
      await window.exec.rememberRepo(p);
      await refreshSavedRepoDisplay();
      setSavedRepoEpoch((e) => e + 1);
      setRepoListEpoch((e) => e + 1);
    } finally {
      setRepoSelectBusy(false);
    }
  }

  function onRepoSavedFromChild() {
    void refreshSavedRepoDisplay();
    setSavedRepoEpoch((e) => e + 1);
    setRepoListEpoch((e) => e + 1);
  }

  useEffect(() => {
    if (typeof window.exec.onCcNavigate !== "function") return;
    return window.exec.onCcNavigate((p) => {
      const v = p?.view as View | undefined;
      if (v && ["home", "workspace", "chats", "profile", "settings", "help"].includes(v)) {
        setView(v);
      }
    });
  }, []);

  useEffect(() => {
    const off = window.exec.onPillVoiceQuestion((text) => {
      setView("workspace");
      // Wrap in an epoch so the consumer effect fires even when the same
      // string comes in twice in a row.
      setPendingVoiceQuestion({ text, epoch: Date.now() });
    });
    return () => off();
  }, []);

  // Stop Web Speech when the user hits Stop on the pill, even if Workspace isn't mounted.
  useEffect(() => {
    const off = window.exec.onPillInterruptSpeech(() => {
      try {
        speechSynthesis.cancel();
      } catch {
        /* noop */
      }
      void window.exec.publishVoiceCaption({ assistant: null });
      void window.exec.workspaceSpeaking(false);
    });
    return () => off();
  }, []);

  useEffect(() => {
    const off = window.exec.onPillToggleScreen(() => {
      if (screenCap.status === "granted") screenCap.stop();
      else screenCap.start();
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenCap.status]);

  // Mirror screen state to the pill so its icon reflects reality.
  useEffect(() => {
    window.exec.workspaceStatus({ screen: screenCap.status === "granted" });
  }, [screenCap.status]);

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
        sessions={sidebarSessions}
        activeSessionId={activeSessionId}
        onOpenChat={(id) => void openExistingChat(id)}
        onDeleteChat={(id) => void deleteSidebarChat(id)}
        onNewChat={() => void startNewChat()}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="drag h-11 shrink-0 border-b border-white/[0.05]" />
        <RepoContextStrip
          path={savedRepoPath}
          label={savedRepoName}
          busy={repoSelectBusy}
          onSelectRepo={() => void handleSelectRepo()}
        />
        <div className="flex-1 overflow-y-auto">
          {view === "home" && (
            <HomePanel
              profileName={profileName}
              repoListEpoch={repoListEpoch}
              onStartChat={(opts) => void startNewChat(opts)}
            />
          )}
          {view === "workspace" && (
            <WorkspacePanel
              pendingVoiceQuestion={pendingVoiceQuestion}
              onConsumeVoiceQuestion={() => setPendingVoiceQuestion(null)}
              getScreenshot={() => screenCap.getLatestFrame()}
              screenStatus={screenCap.status}
              onStartScreen={() => screenCap.start()}
              onStopScreen={() => screenCap.stop()}
              activeSessionId={activeSessionId}
              onSessionChange={(id) => {
                setActiveSessionId(id);
                setSessionListEpoch((e) => e + 1);
              }}
              registerVmaxPanelExecutor={(fn) => { vmaxOverlayExecutorRef.current = fn; }}
              savedRepoEpoch={savedRepoEpoch}
            />
          )}
          {view === "chats" && (
            <ChatsPanel
              activeId={activeSessionId}
              onOpen={(id) => { void openExistingChat(id); }}
              onNew={(id) => { setActiveSessionId(id); setView("workspace"); setSessionListEpoch((e) => e + 1); void window.exec.openOverlay(); }}
            />
          )}
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
  sessions,
  activeSessionId,
  onOpenChat,
  onDeleteChat,
  onNewChat,
}: {
  view: View;
  onView: (v: View) => void;
  profileName: string;
  sessions: { id: string; title: string; updatedAt: number; repoName: string | null }[];
  activeSessionId: string | null;
  onOpenChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onNewChat: () => void;
}) {
  return (
    <aside className="w-[220px] shrink-0 border-r border-white/[0.05] bg-[#0a0a0c] flex flex-col">
      {/* Spacer for traffic lights */}
      <div className="drag h-11 shrink-0 flex items-center pl-[76px] pr-3">
        <div className="text-[12.5px] font-semibold tracking-tight text-white/85">Exec</div>
      </div>

      <nav className="px-2 py-2 space-y-0.5">
        <NavItem icon={<HomeIcon />} label="Home" active={view === "home"} onClick={() => onView("home")} />
        <NavItem icon={<TerminalIcon />} label="Workspace" active={view === "workspace"} onClick={() => onView("workspace")} />
        <NavItem icon={<UserIcon />} label="Profile" active={view === "profile"} onClick={() => onView("profile")} />
        <NavItem icon={<GearIcon />} label="Settings" active={view === "settings"} onClick={() => onView("settings")} />
        <NavItem icon={<HelpIcon />} label="Help" active={view === "help"} onClick={() => onView("help")} />
      </nav>

      <div className="mt-2 px-3 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/40">Chats</div>
        <button
          onClick={onNewChat}
          title="New chat"
          className="text-[15px] leading-none text-white/55 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/[0.06]"
        >
          +
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 mt-1 space-y-0.5">
        {sessions.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-white/35 leading-relaxed">
            No chats yet. Hit + or ask a voice question.
          </div>
        ) : (
          sessions.map((s) => (
            <SidebarChatRow
              key={s.id}
              row={s}
              active={s.id === activeSessionId && view === "workspace"}
              onOpen={() => onOpenChat(s.id)}
              onDelete={() => onDeleteChat(s.id)}
            />
          ))
        )}
      </div>

      <div className="p-2 border-t border-white/[0.05]">
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

function SidebarChatRow({
  row, active, onOpen, onDelete,
}: {
  row: { id: string; title: string; updatedAt: number; repoName: string | null };
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group rounded-lg px-2 py-1.5 flex items-center gap-2 transition-colors
        ${active
          ? "bg-white/[0.07]"
          : "hover:bg-white/[0.04]"}`}
    >
      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <div className={`text-[12px] truncate ${active ? "text-white" : "text-white/80"}`}>
          {row.title || "Untitled"}
        </div>
        {row.repoName && (
          <div className="text-[10px] text-white/40 truncate">{row.repoName}</div>
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-[12px] text-white/40 hover:text-red-300 px-1 leading-none"
        title="Delete chat"
      >
        ×
      </button>
    </div>
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
function TerminalIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}><polyline points="4 8 8 12 4 16" /><line x1="11" y1="16" x2="20" y2="16" /></svg>;
}
function ChatIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}><path d="M21 12a8 8 0 0 1-12.5 6.6L3 20l1.4-5.5A8 8 0 1 1 21 12z" /></svg>;
}
function HelpIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></svg>;
}
