import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RepoStrip from "../components/RepoStrip";
import ActivityBar, { Activity } from "../components/ActivityBar";
import MessageThread, { Msg } from "../components/MessageThread";
import LinearIssuesStrip from "../components/LinearIssuesStrip";
import CommandCards from "../components/CommandCards";
import ResultPanel from "../components/ResultPanel";
import Terminal from "../components/Terminal";
import LiveAgentsPanel from "../components/LiveAgentsPanel";
import type { RepoContext, Plan, FailureExplanation, DiffSummary, VmaxPanelAction } from "../types";
import { buildOpenClawAgentMessage, buildOpenClawFromAskPanel } from "../utils/openClawPrompt";
import { buildOpenClawSpeakable, deriveSpeakable, proseToSpeakable, toSpeakableLine } from "../utils/talkBackText";
import { subscribeSettingsUpdated } from "../utils/subscribeSettingsUpdated";
import { formatRepoContextSummary } from "../utils/repoContextSummary";
import { extractLinearIssueId } from "../utils/extractLinearIssueId";
import { moveLinearIssueToInReview } from "../utils/linearIssuePatch";

type ResultKind = "idle" | "plan" | "failure" | "diff";
type TermLine = { stream: "stdout" | "stderr" | "meta"; text: string };
type WorkspaceSayTone = "info" | "warn" | "success";

type Props = {
  pendingVoiceQuestion?: { text: string; epoch: number } | null;
  onConsumeVoiceQuestion?: () => void;
  /** Pill / overlay → open Add Linear task with AI-filled fields. */
  pendingLinearDraft?: { text: string; epoch: number } | null;
  onConsumeLinearDraft?: () => void;
  getScreenshot?: () => string | null;
  screenStatus?: "idle" | "requesting" | "granted" | "denied";
  onStartScreen?: () => void;
  onStopScreen?: () => void;
  activeSessionId?: string | null;
  onSessionChange?: (id: string | null) => void;
  registerVmaxPanelExecutor?: (fn: ((action: VmaxPanelAction) => void) | null) => void;
  /** Increment when user saves a repo from the global strip so Workspace can resync. */
  savedRepoEpoch?: number;
};

export default function WorkspacePanel({
  pendingVoiceQuestion,
  onConsumeVoiceQuestion,
  pendingLinearDraft,
  onConsumeLinearDraft,
  getScreenshot,
  screenStatus,
  onStartScreen,
  onStopScreen,
  activeSessionId,
  onSessionChange,
  registerVmaxPanelExecutor,
  savedRepoEpoch = 0,
}: Props = {}) {
  // session
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  useEffect(() => { activeRef.current = active; }, [active]);
  const [starting, setStarting] = useState(false);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [repo, setRepo] = useState<RepoContext | null>(null);
  const repoContextSummary = useMemo(() => formatRepoContextSummary(repo), [repo]);

  // task + AI results
  const [task, setTask] = useState("");
  const [resultKind, setResultKind] = useState<ResultKind>("idle");
  const [resultLoading, setResultLoading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [failure, setFailure] = useState<FailureExplanation | null>(null);
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);

  // terminal
  const [lines, setLines] = useState<TermLine[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runCommand, setRunCommand] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const lastRunOutputRef = useRef<string>("");

  const appendWorkspaceTerminal = useCallback((text: string, stream: "stdout" | "stderr") => {
    const line = text.endsWith("\n") ? text : `${text}\n`;
    setLines((prev) => [...prev, { stream, text: line }]);
  }, []);

  // live activity (drives the activity bar + pill busy state)
  const [activity, setActivity] = useState<Activity | null>(null);
  const [lastResultStatus, setLastResultStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const beginActivity = useCallback((kind: Activity["kind"], label: string) => {
    setActivity({ kind, label, startedAt: Date.now() });
    setLastResultStatus(null);
  }, []);
  const endActivity = useCallback((status?: { tone: "ok" | "err"; text: string }) => {
    setActivity(null);
    if (status) {
      setLastResultStatus(status);
      window.setTimeout(() => setLastResultStatus(null), 2500);
    }
  }, []);
  /** Same activity/timer, clearer phase (e.g. after git diff, before AI). */
  const bumpActivityLabel = useCallback((label: string) => {
    setActivity((a) => (a ? { ...a, label } : null));
  }, []);

  // chat thread (general Ask) — independent of repo
  const [messages, setMessages] = useState<Msg[]>([]);
  const [askPending, setAskPending] = useState(false);
  const [linearIssueFromStrip, setLinearIssueFromStrip] = useState<string | null>(null);
  const resolvedLinearIssueId = useMemo(
    () => linearIssueFromStrip || extractLinearIssueId(task),
    [linearIssueFromStrip, task],
  );
  const resolvedLinearRef = useRef<string | null>(null);
  useEffect(() => {
    resolvedLinearRef.current = resolvedLinearIssueId;
  }, [resolvedLinearIssueId]);
  /** Handoff pasted / structured Cursor run finished — prompts user to archive Linear after real work in Cursor. */
  const [afterCursorHandoff, setAfterCursorHandoff] = useState(false);
  /** After My Tasks "Done", offer one-step undo (restore In Review column). Cleared when issue link changes. */
  const [linearUndoAfterDoneId, setLinearUndoAfterDoneId] = useState<string | null>(null);
  const [linearUndoBusy, setLinearUndoBusy] = useState(false);
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Action proposed by the AI but not yet executed — fires after the user
  // confirms ("yes / go ahead / sure"). Null when nothing is pending.
  const pendingActionRef = useRef<{ type: string; name?: string; prompt?: string } | null>(null);
  const cursorAutoSendRef = useRef(true);
  const talkBackEnabledRef = useRef(true);
  const openclawVoiceContextRef = useRef<{ speakable?: string } | null>(null);
  useEffect(() => {
    void window.exec.getSettings().then((s) => {
      cursorAutoSendRef.current = s.cursorAutoSend !== false;
      talkBackEnabledRef.current = s.talkBack !== false;
    });
  }, []);
  useEffect(() => {
    return subscribeSettingsUpdated((sett) => {
      if (typeof sett.talkBack === "boolean") {
        talkBackEnabledRef.current = sett.talkBack;
        if (!sett.talkBack) stopAssistantSpeech();
      }
      if (typeof sett.cursorAutoSend === "boolean") cursorAutoSendRef.current = sett.cursorAutoSend;
    });
  }, []);

  // Status copy from `say` goes to the Workspace terminal (stdout / stderr), not a separate bubble rail.
  const say = useCallback(
    (text: string, tone: WorkspaceSayTone = "info") => {
      appendWorkspaceTerminal(text, tone === "warn" ? "stderr" : "stdout");
    },
    [appendWorkspaceTerminal],
  );

  const undoLinearMarkedDone = useCallback(async () => {
    const cur = resolvedLinearIssueId?.trim().toUpperCase() || "";
    const undoKey = linearUndoAfterDoneId?.trim().toUpperCase() || "";
    if (!cur || cur !== undoKey) return;
    setLinearUndoBusy(true);
    try {
      await moveLinearIssueToInReview(resolvedLinearIssueId!.trim());
      setLinearUndoAfterDoneId(null);
      say(`Moved ${resolvedLinearIssueId} back to In Review in Linear.`, "success");
    } catch (e) {
      say(`Could not undo Linear: ${String((e as Error)?.message || e)}`, "warn");
    } finally {
      setLinearUndoBusy(false);
    }
  }, [resolvedLinearIssueId, linearUndoAfterDoneId, say]);

  /** Drop undo chip if viewer links a different Linear id. */
  useEffect(() => {
    const cur = resolvedLinearIssueId?.trim().toUpperCase() || "";
    setLinearUndoAfterDoneId((prev) => {
      if (!prev) return null;
      return prev.trim().toUpperCase() === cur ? prev : null;
    });
  }, [resolvedLinearIssueId]);

  useEffect(() => {
    if (!resolvedLinearIssueId) setAfterCursorHandoff(false);
  }, [resolvedLinearIssueId]);

  useEffect(() => {
    if (typeof window.exec?.onTaskStatus !== "function") return undefined;
    const off = window.exec.onTaskStatus((rec) => {
      if (rec.selectedAgent !== "cursor") return;
      if (rec.status !== "completed") return;
      if (!resolvedLinearRef.current) return;
      setAfterCursorHandoff(true);
    });
    return () => off();
  }, []);

  const runIdRef = useRef<string | null>(null);
  const runCommandRef = useRef<string | null>(null);
  /** Distinguish shell runs from OpenClaw CLI for post-run UX (no auto “explain failure” on agents). */
  const lastRunKindRef = useRef<"shell" | "openclaw" | "claude">("shell");

  // Auto-loop: after Send to Claude Code, optionally verify with `plan.command`
  // and re-handoff on failure. Capped to maxIter to prevent runaway agent runs.
  type LoopState = { active: boolean; iter: number; max: number; verify: string | null };
  const loopRef = useRef<LoopState>({ active: false, iter: 0, max: 3, verify: null });
  const [loopUI, setLoopUI] = useState<LoopState>(loopRef.current);
  function setLoop(next: LoopState) {
    loopRef.current = next;
    setLoopUI(next);
  }
  function endLoop(reason: string, tone: WorkspaceSayTone = "info") {
    if (!loopRef.current.active) return;
    setLoop({ ...loopRef.current, active: false });
    say(`Auto-loop ended: ${reason}.`, tone);
  }
  const speakGenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const planRef = useRef<Plan | null>(null);
  const failureRef = useRef<FailureExplanation | null>(null);
  useEffect(() => { runIdRef.current = runId; }, [runId]);
  useEffect(() => { runCommandRef.current = runCommand; }, [runCommand]);
  useEffect(() => { planRef.current = plan; }, [plan]);
  useEffect(() => { failureRef.current = failure; }, [failure]);

  // Mirror active/busy to the pill (screen state is broadcast by CommandCenter; overlay merges partial updates).
  useEffect(() => {
    const busy = resultLoading || starting || !!activity || !!runId;
    window.exec.workspaceStatus({ active, busy });
  }, [active, resultLoading, starting, activity, runId]);

  // React to screen status changes with talk-back.
  const prevScreenStatusRef = useRef<typeof screenStatus | undefined>(undefined);
  useEffect(() => {
    const prev = prevScreenStatusRef.current;
    prevScreenStatusRef.current = screenStatus;
    if (prev === undefined) return;
    if (screenStatus === "granted" && prev !== "granted") say("Screen sharing on.", "success");
    if (screenStatus !== "granted" && prev === "granted") say("Stopped screen sharing.");
    if (screenStatus === "denied") say("Screen access denied. Open System Settings → Privacy → Screen Recording.", "warn");
  }, [screenStatus, say]);

  // ---- Talk Back — Web Speech API in renderer (fast, local). Gated by settings toggle. ----
  useEffect(() => {
    const warm = () => {
      try {
        speechSynthesis.getVoices();
      } catch {
        /* noop */
      }
    };
    warm();
    speechSynthesis.addEventListener("voiceschanged", warm);
    return () => speechSynthesis.removeEventListener("voiceschanged", warm);
  }, []);

  function stopAssistantSpeech() {
    speakGenRef.current += 1;
    try { speechSynthesis.cancel(); } catch { /* noop */ }
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.src = ""; } catch { /* noop */ }
      audioRef.current = null;
    }
    void window.exec.publishVoiceCaption({ assistant: null });
    void window.exec.workspaceSpeaking(false);
  }

  /** Concise spoken line after AI / Ask; non-blocking. Uses OpenAI TTS. */
  function speakAloud(text: string, opts?: { maxSentences?: number }) {
    try {
      if (!talkBackEnabledRef.current || !text?.trim()) return;
      const cleaned = toSpeakableLine(text, opts?.maxSentences ?? 2);
      if (!cleaned) return;
      const gen = ++speakGenRef.current;
      try { speechSynthesis.cancel(); } catch { /* noop */ }
      if (audioRef.current) {
        try { audioRef.current.pause(); audioRef.current.src = ""; } catch { /* noop */ }
        audioRef.current = null;
      }
      const cap = cleaned.length > 220 ? `${cleaned.slice(0, 217)}…` : cleaned;
      void (async () => {
        try {
          const { audioBase64, mimeType } = await window.exec.tts({
            text: cleaned,
            voice: "sage",
          });
          if (speakGenRef.current !== gen) return;
          const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
          audioRef.current = audio;
          audio.onplay = () => {
            if (speakGenRef.current !== gen) return;
            void window.exec.publishVoiceCaption({ assistant: cap });
            void window.exec.workspaceSpeaking(true);
          };
          const finish = () => {
            if (speakGenRef.current !== gen) return;
            void window.exec.publishVoiceCaption({ assistant: null });
            void window.exec.workspaceSpeaking(false);
            if (audioRef.current === audio) audioRef.current = null;
          };
          audio.onended = finish;
          audio.onerror = finish;
          await audio.play();
        } catch (err) {
          if (speakGenRef.current !== gen) return;
          // eslint-disable-next-line no-console
          console.error("[exec] OpenAI TTS failed, falling back to system voice", err);
          const u = new SpeechSynthesisUtterance(cleaned);
          const voices = speechSynthesis.getVoices();
          const enVoices = voices.filter((x) => x.lang?.toLowerCase().startsWith("en"));
          const v = enVoices.find((x) => /Samantha|Alex|Daniel/i.test(x.name)) || enVoices[0] || voices[0];
          if (v) u.voice = v;
          u.lang = "en-US";
          u.rate = 1.1;
          u.onstart = () => {
            if (speakGenRef.current !== gen) return;
            void window.exec.publishVoiceCaption({ assistant: cap });
            void window.exec.workspaceSpeaking(true);
          };
          u.onend = u.onerror = () => {
            if (speakGenRef.current !== gen) return;
            void window.exec.publishVoiceCaption({ assistant: null });
            void window.exec.workspaceSpeaking(false);
          };
          speechSynthesis.speak(u);
        }
      })();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[exec] speakAloud failed", err);
      void window.exec.workspaceSpeaking(false);
    }
  }

  // ---- run streaming ----
  useEffect(() => {
    const offData = window.exec.onRunData(({ runId: id, stream, chunk }) => {
      if (id !== runIdRef.current) return;
      lastRunOutputRef.current += chunk;
      setLines((prev) => [...prev, { stream, text: chunk }]);
    });
    const offEnd = window.exec.onRunEnd(({ runId: id, code, error }) => {
      if (id !== runIdRef.current) return;
      const runKind = lastRunKindRef.current;
      lastRunKindRef.current = "shell";
      if (error) {
        lastRunOutputRef.current += "\n" + error;
        setLines((prev) => [...prev, { stream: "stderr", text: "\n" + error }]);
      }
      setLines((prev) => [...prev, { stream: "meta", text: `\n— exit ${code} —\n` }]);
      setExitCode(code);
      const finishedCmd = runCommandRef.current;
      const finishedOutput = lastRunOutputRef.current;
      setRunId(null);
      runIdRef.current = null;
      if (runKind === "openclaw") {
        const voiceCtx = openclawVoiceContextRef.current;
        openclawVoiceContextRef.current = null;
        if (code === 125 && finishedCmd) {
          endActivity({ tone: "err", text: "OpenClaw blocked" });
          say(error || "OpenClaw run was blocked.", "warn");
          speakAloud(buildOpenClawSpeakable(code, finishedOutput, voiceCtx?.speakable));
        } else if (code !== 0 && finishedCmd) {
          endActivity({ tone: "err", text: "OpenClaw error" });
          say("OpenClaw exited with an error — full output is in the terminal.", "warn");
          speakAloud(buildOpenClawSpeakable(code, finishedOutput, voiceCtx?.speakable));
        } else if (code === 0 && finishedCmd) {
          endActivity({ tone: "ok", text: "OpenClaw completed" });
          say("OpenClaw finished — scroll the terminal for the agent reply.", "success");
          speakAloud(buildOpenClawSpeakable(code, finishedOutput, voiceCtx?.speakable));
        } else {
          endActivity();
        }
        return;
      }

      // Claude Code run: when the loop is active, success → run verify next.
      if (runKind === "claude") {
        if (code === 0) {
          endActivity({ tone: "ok", text: "Claude Code finished" });
          say("Claude Code finished.", "success");
          if (loopRef.current.active && loopRef.current.verify) {
            const v = loopRef.current.verify;
            say(`Verifying with: ${v}`);
            window.setTimeout(() => startCommand(v), 200);
          }
        } else {
          endActivity({ tone: "err", text: "Claude Code error" });
          say(error || "Claude Code exited with an error.", "warn");
          endLoop("Claude Code returned an error", "warn");
        }
        return;
      }
      /** Demo policy: blocked commands exit 125 without spawning (see utils/commandSafety.js). */
      if (code === 125 && finishedCmd) {
        endActivity({ tone: "err", text: "Command blocked" });
        say(
          error || "That command isn’t allowed in demo mode. Check the terminal for details — you can still type and run safe checks.",
          "warn",
        );
      } else if (code !== 0 && active && finishedCmd) {
        endActivity({ tone: "err", text: `${finishedCmd} failed (exit ${code})` });
        say(`${finishedCmd} failed (exit ${code}). Looking at it…`, "warn");
        runExplainFailure(finishedCmd, finishedOutput);
      } else if (code === 0 && finishedCmd) {
        endActivity({ tone: "ok", text: `${finishedCmd} passed` });
        say(`${finishedCmd} passed.`, "success");
        if (loopRef.current.active && loopRef.current.verify === finishedCmd) {
          endLoop("verify passed", "success");
        }
      } else {
        endActivity();
      }
    });
    return () => { offData(); offEnd(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ---- session load + autosave ----
  // When activeSessionId changes (or on first mount), load that chat's
  // task / plan / failure / diff / messages into the workspace. If no session
  // is active, fall back to the last-used repo (legacy behavior).
  const loadedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hadLoaded = loadedSessionRef.current;

      /** Selection cleared from the chat sidebar — reset transcript/plan/task state (keep repo if any). */
      if (!activeSessionId && hadLoaded) {
        loadedSessionRef.current = null;
        lastTitleRef.current = "";
        pendingActionRef.current = null;
        setLinearIssueFromStrip(null);
        setAfterCursorHandoff(false);
        setLinearUndoAfterDoneId(null);
        setTask("");
        setPlan(null);
        setFailure(null);
        setDiffSummary(null);
        setMessages([]);
        setResultKind("idle");
        setLines([]);
        setRunId(null);
        runIdRef.current = null;
        setRunCommand(null);
        setExitCode(null);
        lastRunOutputRef.current = "";
        setLoop({ active: false, iter: 0, max: 3, verify: null });
        return;
      }

      if (activeSessionId && activeSessionId !== loadedSessionRef.current) {
        setLinearIssueFromStrip(null);
        setAfterCursorHandoff(false);
        setLinearUndoAfterDoneId(null);
        const s = await window.exec.getSession(activeSessionId);
        if (cancelled || !s) return;
        loadedSessionRef.current = activeSessionId;
        setTask(s.task || "");
        setPlan(s.plan || null);
        setFailure(s.failure || null);
        setDiffSummary(s.diffSummary || null);
        setMessages(Array.isArray(s.messages) ? s.messages : []);
        setResultKind(s.plan ? "plan" : s.failure ? "failure" : s.diffSummary ? "diff" : "idle");
        if (s.repoPath && String(s.repoPath).trim()) {
          await activateWithRepo(String(s.repoPath).trim());
        } else {
          deactivateRepo();
        }
        return;
      }
      if (!activeSessionId && !repoPath) {
        const last = await window.exec.getLastRepo();
        if (!cancelled && last) await activateWithRepo(last);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // Debounced save of meaningful state into the active session. Auto-creates a
  // session on first save if none exists yet, so chats just "happen" as the
  // user works.
  const saveTimerRef = useRef<number | null>(null);
  const lastTitleRef = useRef<string>("");
  useEffect(() => {
    // Persist whenever there's content — even without an active repo so
    // general Ask conversations get saved.
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      saveTimerRef.current = null;
      try {
        let id = activeSessionId;
        // Title priority: typed task → first user message in the thread → fallback.
        const firstUserMsg = messages.find((m) => m.role === "user")?.text || "";
        const titleSource = task.trim() || firstUserMsg.trim();
        const titleFromTask = (titleSource.split(/\n/)[0] || "").slice(0, 80) || "New chat";
        if (!id) {
          const hasContent = task.trim() || plan || failure || diffSummary || messages.length;
          if (!hasContent) return;
          const seed = await window.exec.newSession({
            title: titleFromTask,
            repoPath: repoPath || undefined,
            repoName: repo?.ok ? repo.name : undefined,
          });
          const newId = seed?.id as string | undefined;
          if (!newId) return;
          id = newId;
          loadedSessionRef.current = newId;
          onSessionChange?.(newId);
        }
        const title = titleFromTask !== lastTitleRef.current ? titleFromTask : undefined;
        if (title) lastTitleRef.current = title;
        // Round-trip through JSON to strip any non-serializable values (defensive).
        const safe = JSON.parse(JSON.stringify({
          id,
          title: title || undefined,
          task,
          plan,
          failure,
          diffSummary,
          bubbles: [],
          messages: messages.slice(-100),
          repoPath: repoPath || null,
          repoName: repo?.ok ? repo.name : null,
        }));
        await window.exec.saveSession(safe);
      } catch (err) {
        // Never let a save error blow up the workspace.
        // eslint-disable-next-line no-console
        console.error("[exec] saveSession failed", err);
      }
    }, 600);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, plan, failure, diffSummary, messages, active, repoPath, activeSessionId]);

  // ---- pill bus ----
  const taskRef = useRef(task);
  useEffect(() => { taskRef.current = task; }, [task]);

  // Voice question lifted up to CommandCenter so it isn't lost when the
  // workspace tab isn't mounted. Process it here once the workspace has a
  // live repo (auto-activate runs on mount via getLastRepo).
  useEffect(() => {
    if (!pendingVoiceQuestion) return;
    const { text } = pendingVoiceQuestion;
    onConsumeVoiceQuestion?.();
    if (!text || !text.trim()) return;
    runAsk(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVoiceQuestion?.epoch]);

  useEffect(() => {
    const offT = window.exec.onPillTranscript((text) => {
      const next = taskRef.current.trim() ? `${taskRef.current.trim()} ${text}` : text;
      setTask(next);
      say("Got it — I heard you.");
    });
    const offC = window.exec.onPillRequestCursor(() => {
      const prompt = planRef.current?.cursorPrompt || failureRef.current?.cursorPrompt;
      if (!prompt) { say("No Cursor prompt yet — Plan a task or run a check first.", "warn"); return; }
      sendToCursor(prompt);
    });
    const offI = window.exec.onPillInterruptSpeech(() => {
      stopAssistantSpeech();
    });
    return () => { offT(); offC(); offI(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- start / scan ----
  async function startExec() {
    if (active) return;
    setStarting(true);
    try {
      let p = repoPath || (await window.exec.getLastRepo());
      if (!p) {
        p = await window.exec.pickRepo();
        if (!p) return;
      }
      await activateWithRepo(p);
    } finally { setStarting(false); }
  }
  async function changeRepo() {
    const p = await window.exec.pickRepo();
    if (!p) return;
    await window.exec.rememberRepo(p);
    setStarting(true);
    try { await activateWithRepo(p); } finally { setStarting(false); }
  }
  async function activateWithRepo(p: string) {
    setRepoPath(p);
    say("Scanning repo…");
    setActive(true);
    const ctx = await window.exec.scanRepo(p);
    setRepo(ctx);
    if (ctx.ok) {
      window.exec.rememberRepo(p);
      say(`Watching ${ctx.name} on ${ctx.branch}.`, "success");
      if (ctx.changedFiles.length > 0)
        say(`I found ${ctx.changedFiles.length} changed file${ctx.changedFiles.length === 1 ? "" : "s"}.`);
      say("Ready. Paste a task, then hit Plan Task.");
    } else {
      say(ctx.error, "warn");
    }
  }

  function deactivateRepo() {
    setActive(false);
    setRepoPath(null);
    setRepo(null);
  }

  async function rescan() {
    if (!repoPath) return;
    const ctx = await window.exec.scanRepo(repoPath);
    setRepo(ctx);
    if (ctx.ok) say("Rescanned repo.");
  }

  useEffect(() => {
    if (!savedRepoEpoch) return;
    void (async () => {
      const p = await window.exec.getLastRepo();
      if (!p || !activeRef.current) return;
      setStarting(true);
      try {
        await activateWithRepo(p);
      } finally {
        setStarting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- epoch bump only; active read via ref
  }, [savedRepoEpoch]);

  const workspaceLinearRepoSync = useMemo(
    () => ({
      repoPath,
      repoName: repo?.ok === true ? repo.name : null,
    }),
    [repoPath, repo],
  );

  function isAffirmative(s: string) {
    return /^(yes|yeah|yep|yup|sure|ok(?:ay)?|go ahead|do it|please do|create it|sounds good|let'?s do it|confirmed?|that works|yes please)\b/i.test(s.trim());
  }
  function isNegative(s: string) {
    return /^(no|nope|cancel|don'?t|stop|never mind|abort|skip)\b/i.test(s.trim());
  }

  /** Human-readable path for Cursor handoff (CLI vs open, AppleScript vs clipboard). */
  function describeCursorHandoff(r: {
    ok: boolean;
    reason?: string;
    message?: string;
    openedRepoVia?: string;
    pastedVia?: string;
    automationFailed?: boolean;
    pasteShortcut?: string;
  }): string {
    if (!r.ok) {
      if (r.reason === "accessibility") {
        return "Need Accessibility permission for Vmax (Electron) in System Settings. Prompt is on your clipboard.";
      }
      return r.message || `Cursor handoff failed${r.reason ? ` (${r.reason})` : ""}. Prompt is on your clipboard.`;
    }
    const bits: string[] = [];
    if (r.openedRepoVia === "cursor-cli" || r.openedRepoVia === "cursor-path") {
      bits.push("Opened the repo with the Cursor CLI");
    } else if (r.openedRepoVia === "cursor-bundled") {
      bits.push("Opened the repo with Cursor’s bundled CLI helper");
    } else if (r.openedRepoVia === "open-app") {
      bits.push("Opened Cursor via macOS open");
    } else {
      bits.push("Could not launch Cursor automatically from here");
    }
    if (r.pastedVia === "applescript") {
      bits.push(r.pasteShortcut ? `pasted using ${r.pasteShortcut}` : "pasted using keyboard automation");
    } else {
      bits.push("prompt is on the clipboard — focus Cursor Agent or Chat, then ⌘V");
    }
    let s = `${bits.join(". ")}.`;
    if (r.automationFailed && r.message) s += ` ${r.message}`;
    return s;
  }

  // ---- general Ask (screen-aware, repo-optional) ----
  async function runAsk(question: string) {
    const q = (question || "").trim();
    if (!q) return;

    // If an action is pending, intercept yes/no first.
    if (pendingActionRef.current) {
      if (isAffirmative(q)) {
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        setMessages((prev) => [...prev, { role: "user", text: q, ts: Date.now() }, { role: "assistant", text: "On it.", ts: Date.now() }]);
        speakAloud("On it.", { maxSentences: 1 });
        if (action.type === "create-project") await runCreateProjectAction(action);
        else if (action.type === "scan-repo") await runScanRepoAction();
        else if (action.type === "send-to-cursor") {
          const prompt = planRef.current?.cursorPrompt || failureRef.current?.cursorPrompt;
          if (prompt) await sendToCursor(prompt);
          else say("No Cursor prompt yet — Plan a task or run a check first.", "warn");
        }
        return;
      }
      if (isNegative(q)) {
        pendingActionRef.current = null;
        setMessages((prev) => [...prev, { role: "user", text: q, ts: Date.now() }, { role: "assistant", text: "Okay, I'll skip it.", ts: Date.now() }]);
        speakAloud("Okay, I'll skip it.", { maxSentences: 1 });
        return;
      }
      // Otherwise: keep the pending action but fall through to a normal ask.
    }

    setMessages((prev) => [...prev, { role: "user", text: q, ts: Date.now() }]);
    setAskPending(true);
    beginActivity("plan", "Asking Vmax…");
    try {
      const settings = await window.exec.getSettings();
      cursorAutoSendRef.current = settings.cursorAutoSend !== false;
      const screenshotBase64 = getScreenshot?.() || null;
      if (typeof window.exec.publishVmaxResponse === "function") {
        void window.exec.publishVmaxResponse({ phase: "loading", question: q });
      }
      if (typeof window.exec.setOverlayExpanded === "function") {
        void window.exec.setOverlayExpanded(true);
      }
      const askSummary = repo?.ok && repoContextSummary ? repoContextSummary : "";
      const res = await window.exec.ask({
        question: q,
        screenshotBase64,
        history: messagesRef.current.slice(-6),
        ...(askSummary.trim() ? { repoContextSummary: askSummary.trim() } : {}),
      });
      const { prose, action } = parseActionTag(res.text);
      setMessages((prev) => [...prev, { role: "assistant", text: prose, ts: Date.now() }]);
      endActivity({ tone: "ok", text: "Answered" });
      if (typeof window.exec.publishVmaxResponse === "function") {
        void window.exec.publishVmaxResponse({
          phase: "ready",
          question: q,
          panel: res.structured,
          parseWarning: res.parseWarning,
        });
      }
      speakAloud(deriveSpeakable(res.structured.speakableSummary, res.text));
      if (action) {
        const autoSend =
          cursorAutoSendRef.current
          && repo?.ok
          && (action.type === "scan-repo" || action.type === "send-to-cursor");
        if (autoSend) {
          if (action.type === "send-to-cursor") {
            const prompt = planRef.current?.cursorPrompt || failureRef.current?.cursorPrompt;
            if (!prompt) say("No Cursor prompt yet — plan a task or run a check first.", "warn");
            else await sendToCursor(prompt);
          } else {
            await runScanRepoAction();
          }
        } else {
          pendingActionRef.current = action;
        }
      }
    } catch (err) {
      endActivity({ tone: "err", text: "Ask failed" });
      const msg = `Ask failed: ${(err as Error).message}`;
      setMessages((prev) => [...prev, { role: "assistant", text: msg, ts: Date.now() }]);
      say(msg, "warn");
      if (typeof window.exec.publishVmaxResponse === "function") {
        void window.exec.publishVmaxResponse({ phase: "error", message: msg });
      }
    } finally {
      setAskPending(false);
    }
  }

  async function runScanRepoAction() {
    if (!repo?.ok || !repoPath) {
      const msg = "Need an active repo to scan. Start Vmax on a repo first.";
      setMessages((prev) => [...prev, { role: "assistant", text: msg, ts: Date.now() }]);
      speakAloud(proseToSpeakable(msg));
      return;
    }
    beginActivity("diff", "Scanning repo for issues…");
    try {
      const diff = await getDiffText();
      const summary = await window.exec.summarizeDiff({ diff });
      // Compose a one-line voice answer from the structured summary.
      const headline = summary.summary || "Scan complete.";
      const risks = (summary.risks || []).slice(0, 3).map((r) => `• ${r}`).join("\n");
      const reply = risks ? `${headline}\nRisks I'd watch:\n${risks}` : headline;
      setDiffSummary(summary);
      setResultKind("diff");
      setMessages((prev) => [...prev, { role: "assistant", text: reply, ts: Date.now() }]);
      endActivity({ tone: "ok", text: "Scan done" });
      speakAloud(
        deriveSpeakable(
          summary.speakableSummary,
          headline + (summary.risks?.length ? `. ${summary.risks.length} risk${summary.risks.length === 1 ? "" : "s"} flagged.` : ""),
        ),
      );
    } catch (err) {
      endActivity({ tone: "err", text: "Scan failed" });
      const msg = `Scan failed: ${(err as Error).message}`;
      setMessages((prev) => [...prev, { role: "assistant", text: msg, ts: Date.now() }]);
      say(msg, "warn");
    }
  }

  async function runCreateProjectAction(action: { name?: string; prompt?: string }) {
    const name = (action.name || "").trim() || "new-project";
    const prompt = (action.prompt || "").trim();
    beginActivity("run", `Creating project ${name}…`);
    say(`Creating project '${name}' on Desktop…`);
    try {
      const r = await window.exec.createProject({ name });
      if (!r.ok) throw new Error("createProject failed");
      say(`Created ${r.path}. Opening Cursor and pasting the prompt…`, "success");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `✓ Created project at ${r.path}.`, ts: Date.now() },
      ]);
      endActivity({ tone: "ok", text: `Created ${r.name}` });
      // Remember the new repo so Workspace activates with it.
      await window.exec.rememberRepo(r.path);
      // Immediately drive Cursor's Composer with the prompt.
      if (prompt) {
        const sent = await window.exec.sendToCursorChat({ repoPath: r.path, prompt });
        say(describeCursorHandoff(sent), sent.ok && !sent.automationFailed ? "success" : "warn");
      }
    } catch (err) {
      endActivity({ tone: "err", text: "Project creation failed" });
      say(`Project creation failed: ${(err as Error).message}`, "warn");
    }
  }

  function parseActionTag(text: string): {
    prose: string;
    action: { type: string; name?: string; prompt?: string } | null;
  } {
    if (!text) return { prose: "", action: null };
    const m = text.match(/\[\[action\s+([a-z-]+)([^\]]*)\]\]/i);
    if (!m) return { prose: text, action: null };
    const type = m[1];
    const attrs = m[2] || "";
    // Pull name="..." and prompt="..."
    const name = matchAttr(attrs, "name");
    const prompt = matchAttr(attrs, "prompt");
    const prose = text.replace(m[0], "").trim();
    return { prose, action: { type, name, prompt } };
  }
  function matchAttr(s: string, key: string): string | undefined {
    const m = s.match(new RegExp(`${key}="((?:[^"\\\\]|\\\\.)*)"`, "i"));
    if (!m) return undefined;
    return m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }

  // ---- AI ----
  async function getDiffText(): Promise<string> {
    if (!repoPath) return "";
    return new Promise((resolve) => {
      const id = newRunId();
      let out = "";
      const offD = window.exec.onRunData((e) => { if (e.runId === id) out += e.chunk; });
      const offE = window.exec.onRunEnd((e) => { if (e.runId !== id) return; offD(); offE(); resolve(out); });
      window.exec.run({ runId: id, repoPath, command: "git diff" });
    });
  }

  async function runPlan(taskOverride?: string) {
    if (!repo?.ok) return;
    const overrideStr = typeof taskOverride === "string" ? taskOverride : undefined;
    const t = (overrideStr ?? taskRef.current ?? task).trim();
    if (!t) { say("Add a task first — paste from Linear or describe what to build.", "warn"); return; }
    setResultKind("plan"); setResultLoading(true); setPlan(null);
    beginActivity("plan", "Planning the task…");
    say("Planning the task…");
    try {
      bumpActivityLabel("Gathering git diff…");
      const diff = await getDiffText();
      bumpActivityLabel("Calling AI (Claude / OpenAI)…");
      const screenshotBase64 = getScreenshot?.() || null;
      const result = await window.exec.plan({ task: t, repo, diff, screenshotBase64, repoContextSummary });
      setPlan(result);
      endActivity({ tone: "ok", text: "Plan ready" });
      say("Plan ready. Cursor prompt is queued.", "success");
      speakAloud(deriveSpeakable(result.speakableSummary, result.summary));
    } catch (err) {
      endActivity({ tone: "err", text: "Plan failed" });
      say(`Plan failed: ${(err as Error).message}`, "warn");
      setResultKind("idle");
    } finally { setResultLoading(false); }
  }
  async function runSummarizeDiff() {
    if (!repo?.ok) return;
    setResultKind("diff"); setResultLoading(true); setDiffSummary(null);
    beginActivity("diff", "Summarizing diff…");
    say("Summarizing diff…");
    try {
      bumpActivityLabel("Gathering git diff…");
      const diff = await getDiffText();
      bumpActivityLabel("Calling AI (Claude / OpenAI)…");
      const result = await window.exec.summarizeDiff({ diff });
      setDiffSummary(result);
      endActivity({ tone: "ok", text: "Diff summarized" });
      say("Diff summarized.", "success");
      speakAloud(deriveSpeakable(result.speakableSummary, result.summary));
    } catch (err) {
      endActivity({ tone: "err", text: "Summarize failed" });
      say(`Summarize failed: ${(err as Error).message}`, "warn"); setResultKind("idle");
    } finally { setResultLoading(false); }
  }
  async function runExplainFailure(command: string, output: string) {
    if (!repo?.ok) return;
    setResultKind("failure"); setResultLoading(true); setFailure(null);
    beginActivity("failure", `Explaining ${command} failure…`);
    try {
      const screenshotBase64 = getScreenshot?.() || null;
      const result = await window.exec.explainFailure({
        task,
        repo,
        command,
        output,
        screenshotBase64,
        repoContextSummary,
      });
      setFailure(result);
      endActivity({ tone: "ok", text: "Diagnosis ready" });
      say("I have a guess — see the explanation above.", "success");
      speakAloud(deriveSpeakable(result.speakableSummary, `${result.what} ${result.cause}`));

      // Auto-loop continuation: if we're inside a Claude Code loop and we got
      // a fix prompt back, fire the next iteration. Stop once we hit max.
      const claudeHandoff = result.claudePrompt || result.cursorPrompt;
      if (loopRef.current.active && claudeHandoff) {
        const next = loopRef.current.iter + 1;
        if (next > loopRef.current.max) {
          endLoop(`hit max iterations (${loopRef.current.max})`, "warn");
        } else {
          setLoop({ ...loopRef.current, iter: next });
          say(`Loop ${next}/${loopRef.current.max} — sending fix to Claude…`);
          window.setTimeout(() => sendToClaudeCli(claudeHandoff), 350);
        }
      }
    } catch (err) {
      endActivity({ tone: "err", text: "Explain failed" });
      say(`Explain failed: ${(err as Error).message}`, "warn"); setResultKind("idle");
    } finally { setResultLoading(false); }
  }

  // ---- terminal ----
  function newRunId() { return "r-" + Math.random().toString(36).slice(2, 10); }
  function startCommand(command: string) {
    if (!repoPath) return;
    if (runIdRef.current) return;
    lastRunKindRef.current = "shell";
    const id = newRunId();
    runIdRef.current = id; runCommandRef.current = command; lastRunOutputRef.current = "";
    setRunId(id); setRunCommand(command); setExitCode(null);
    setLines((prev) => [...prev, { stream: "meta", text: `\n$ ${command}\n` }]);
    beginActivity("run", `Running: ${command}`);
    window.exec.run({ runId: id, repoPath, command });
  }
  function startOpenClawFromResult() {
    if (!repoPath || !repo?.ok) return;
    if (runIdRef.current) return;
    if (resultKind !== "plan" && resultKind !== "failure" && resultKind !== "diff") return;
    const message = buildOpenClawAgentMessage({
      task,
      repo,
      kind: resultKind,
      plan,
      failure,
      diff: diffSummary,
    });
    if (!message) {
      say("Nothing to send to OpenClaw yet.", "warn");
      return;
    }
    const speakableHint =
      resultKind === "plan"
        ? plan?.speakableSummary
        : resultKind === "failure"
          ? failure?.speakableSummary
          : diffSummary?.speakableSummary;
    openclawVoiceContextRef.current = { speakable: speakableHint };
    const id = newRunId();
    lastRunKindRef.current = "openclaw";
    runIdRef.current = id;
    runCommandRef.current = "openclaw agent";
    lastRunOutputRef.current = "";
    setRunId(id);
    setRunCommand("openclaw agent");
    setExitCode(null);
    setLines((prev) => [
      ...prev,
      { stream: "meta", text: `\n$ openclaw agent (prompt ${message.length} chars — output below)\n` },
    ]);
    beginActivity("openclaw", "OpenClaw agent running…");
    say(
      "Sending to OpenClaw — you stay in control via its approvals; stdout and stderr stream in the terminal.",
      "info",
    );
    window.exec.openclawAgent({ runId: id, repoPath, message });
  }
  function cancelRun() { if (runId) window.exec.cancelRun(runId); }
  function clearTerminal() { setLines([]); setExitCode(null); setRunCommand(null); }

  /** Hide Plan Task / Typecheck / Lint / Tests / Summarize Diff — set true to restore. */
  const SHOW_WORKSPACE_COMMAND_CARDS = false;

  // cards (see SHOW_WORKSPACE_COMMAND_CARDS above)
  const cards = useMemo(() => {
    if (!SHOW_WORKSPACE_COMMAND_CARDS) return [];
    return [
    { key: "plan", title: "Plan Task", hint: "Tactical plan + Cursor prompt",
      enabled: active && repo?.ok === true && !resultLoading,
      loading: resultLoading && resultKind === "plan", onClick: runPlan },
    { key: "typecheck", title: "Typecheck", hint: "npm run typecheck",
      enabled: active && repo?.ok === true && !runId && !resultLoading,
      loading: !!runId && runCommand === "npm run typecheck",
      onClick: () => startCommand("npm run typecheck") },
    { key: "lint", title: "Lint", hint: "npm run lint",
      enabled: active && repo?.ok === true && !runId && !resultLoading,
      loading: !!runId && runCommand === "npm run lint",
      onClick: () => startCommand("npm run lint") },
    { key: "tests", title: "Tests", hint: "npm run test",
      enabled: active && repo?.ok === true && !runId && !resultLoading,
      loading: !!runId && runCommand === "npm run test",
      onClick: () => startCommand("npm run test") },
    { key: "diff", title: "Summarize Diff", hint: "git diff → summary",
      enabled: active && repo?.ok === true && !resultLoading,
      loading: resultLoading && resultKind === "diff", onClick: runSummarizeDiff },
    ];
    // Stable handlers omitted: runPlan, runSummarizeDiff, startCommand
    // eslint-disable-next-line react-hooks/exhaustive-deps -- card grid toggled by SHOW_WORKSPACE_COMMAND_CARDS
  }, [SHOW_WORKSPACE_COMMAND_CARDS, active, repo?.ok, resultLoading, resultKind, runId, runCommand]);

  // handoff
  async function copyCursorPrompt(prompt: string) {
    await window.exec.copy(prompt);
    say("Prompt copied. Paste into Cursor.", "success");
  }

  // Run the generated prompt with Claude Code CLI inside the active repo.
  // Reuses startCommand's runId / streaming / activity wiring so the terminal
  // panel and ActivityBar light up automatically — UI never freezes.
  async function sendToClaudeCli(prompt: string) {
    if (!repoPath) {
      say("No active repo for Claude Code CLI.", "warn");
      return;
    }
    if (runIdRef.current) {
      say("Wait for the current run to finish before starting Claude Code.", "warn");
      return;
    }
    if (!loopRef.current.active) {
      const verify = planRef.current?.command?.trim() || null;
      if (verify) {
        setLoop({ active: true, iter: 0, max: 3, verify });
        say(`Auto-loop armed: will run "${verify}" after Claude finishes (max 3 iterations).`);
      }
    }
    lastRunKindRef.current = "claude";
    const id = newRunId();
    runIdRef.current = id;
    runCommandRef.current = "claude -p <prompt>";
    lastRunOutputRef.current = "";
    setRunId(id);
    setRunCommand("claude -p <prompt>");
    setExitCode(null);
    setLines((prev) => [...prev, { stream: "meta", text: `\n$ claude -p <prompt> (in ${repo?.ok ? repo.name : "repo"})\n` }]);
    beginActivity("run", "Running Claude Code…");
    say("Sent prompt to Claude Code CLI. Streaming output below.");
    try {
      const res = await window.exec.runClaudeCli({ runId: id, repoPath, prompt });
      if (!res.started) {
        setRunId(null);
        runIdRef.current = null;
        setRunCommand(null);
        endActivity({ tone: "err", text: "Claude Code didn't start" });
        say(res.error || "Claude Code CLI is not available — see the message in the terminal.", "warn");
        endLoop("Claude CLI failed to start", "warn");
      }
    } catch (err) {
      setRunId(null);
      runIdRef.current = null;
      setRunCommand(null);
      endActivity({ tone: "err", text: "Claude Code didn't start" });
      say(`Claude Code failed to start: ${(err as Error).message}`, "warn");
      endLoop("Claude CLI failed to start", "warn");
    }
  }
  async function sendToCursor(prompt: string) {
    if (!repoPath) {
      await window.exec.copy(prompt);
      say("No active repo — copied the prompt. Paste it into Cursor.", "warn");
      return;
    }
    beginActivity("cursor", "Handoff to Cursor…");
    say("Opening Cursor and sending prompt…");
    const r = await window.exec.sendToCursorChat({ repoPath, prompt });
    const line = describeCursorHandoff(r);
    const linked =
      linearIssueFromStrip ||
      extractLinearIssueId(prompt) ||
      null;
    if (linked && r.ok && !r.automationFailed) {
      setAfterCursorHandoff(true);
    }
    if (r.ok) {
      endActivity({ tone: "ok", text: "Sent to Cursor" });
      say(line, r.automationFailed ? "warn" : "success");
    } else if (r.reason === "accessibility") {
      endActivity({ tone: "err", text: "Cursor blocked: Accessibility" });
      say(line, "warn");
    } else {
      endActivity({ tone: "err", text: "Cursor handoff failed" });
      say(line, "warn");
    }
  }

  function startOpenClawWithMessage(message: string) {
    if (!repoPath || !repo?.ok) {
      say("Start Vmax on a repo before running OpenClaw.", "warn");
      return;
    }
    if (runIdRef.current) {
      say("Wait for the current run to finish.", "warn");
      return;
    }
    const msg = message.trim();
    if (!msg) return;
    openclawVoiceContextRef.current = null;
    const id = newRunId();
    lastRunKindRef.current = "openclaw";
    runIdRef.current = id;
    runCommandRef.current = "openclaw agent";
    lastRunOutputRef.current = "";
    setRunId(id);
    setRunCommand("openclaw agent");
    setExitCode(null);
    setLines((prev) => [
      ...prev,
      { stream: "meta", text: `\n$ openclaw agent (prompt ${msg.length} chars — output below)\n` },
    ]);
    beginActivity("openclaw", "OpenClaw agent running…");
    say("Sending to OpenClaw…", "info");
    void window.exec.openclawAgent({ runId: id, repoPath, message: msg });
  }

  const vmaxExecRef = useRef<((action: VmaxPanelAction) => void) | null>(null);
  vmaxExecRef.current = (action: VmaxPanelAction) => {
    void window.exec.focusCommandCenter();
    if (action.type === "send-cursor") void sendToCursor(action.prompt);
    else if (action.type === "run-claude") void sendToClaudeCli(action.prompt);
    else if (action.type === "run-command") startCommand(action.command);
    else if (action.type === "openclaw") {
      const message = buildOpenClawFromAskPanel({
        question: action.question,
        repo,
        panel: action.panel,
      });
      if (message) startOpenClawWithMessage(message);
      else say("Could not build OpenClaw message.", "warn");
    }
  };

  const registerExecutorRef = useRef(registerVmaxPanelExecutor);
  registerExecutorRef.current = registerVmaxPanelExecutor;

  useEffect(() => {
    const reg = registerExecutorRef.current;
    if (!reg) return undefined;
    const dispatch = (action: VmaxPanelAction) => vmaxExecRef.current?.(action);
    reg(dispatch);
    return () => reg(null);
  }, []);

  return (
    <div className="w-full max-w-none box-border px-4 sm:px-6 lg:px-8 pt-6 pb-12 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div>
          <div className="text-[18px] font-semibold tracking-tight">Workspace</div>
          <div className="text-[12.5px] text-white/50 mt-0.5">
            Your live session — task, plan, and run output, all in one place.
          </div>
        </div>
        {!active ? (
          <button
            onClick={startExec}
            disabled={starting}
            className={`ml-auto h-9 px-4 rounded-lg text-[12.5px] font-medium tracking-tight
                        bg-white text-black hover:bg-white/90
                        shadow-[0_0_24px_-4px_rgba(255,255,255,0.45)]
                        ${starting ? "opacity-60 cursor-wait" : ""}`}
          >
            {starting ? "Starting…" : "Start Vmax"}
          </button>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={changeRepo}
              className="h-9 px-3 rounded-lg text-[12px] font-medium bg-black text-white border border-white/90
                         hover:bg-white/[0.06] hover:text-white hover:border-white"
            >
              Select Repo
            </button>
          </div>
        )}
      </div>

      {/* Repo strip + activity bar only matter when a repo is active */}
      {active && (
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
          <RepoStrip repo={repo} onRescan={rescan} />
        </div>
      )}

      <ActivityBar activity={activity} resultFlash={lastResultStatus} />

      <LinearIssuesStrip
        say={say}
        onTerminalAppend={appendWorkspaceTerminal}
        onFillTask={setTask}
        onLinearIssueFocus={setLinearIssueFromStrip}
        onBriefReadySendToCursor={(text) => {
          void sendToCursor(text);
        }}
        voiceDraftFromPill={pendingLinearDraft}
        onConsumeVoiceDraftFromPill={onConsumeLinearDraft}
        workspaceRepoSync={workspaceLinearRepoSync}
      />
      {resolvedLinearIssueId ? (
        <div
          className={`rounded-xl border px-3 py-2.5 ${
            afterCursorHandoff
              ? "border-emerald-400/35 bg-emerald-500/[0.07]"
              : "border-white/[0.08] bg-white/[0.02]"
          }`}
        >
          <div className="text-[11px] text-white/75 leading-snug space-y-1.5">
            {afterCursorHandoff ? (
              <p>
                <span className="font-medium text-emerald-100/95">Cursor has the enriched brief.</span> Finish there, then
                tap{" "}
                <strong className="text-emerald-200/90">Done</strong> for <span className="mono">{resolvedLinearIssueId}</span>{" "}
                on that row in <strong className="text-white/82">My Tasks</strong>. Vmax doesn&apos;t watch Cursor for
                completion automatically.
              </p>
            ) : (
              <p>
                Linked issue <span className="mono text-violet-200/95">{resolvedLinearIssueId}</span>. After agent brief{" "}
                → Cursor succeeds from <strong className="text-white/82">My Tasks</strong>, tap{" "}
                <strong className="text-white/85">Done</strong> on that row to move it to Linear&apos;s completed column.
              </p>
            )}
            <p className="text-[10px] text-white/40 leading-snug">
              Maps to your board&apos;s <code className="mono text-white/55">completed</code> workflow type when Linear accepts the update.
            </p>
          </div>
          {linearUndoAfterDoneId &&
          resolvedLinearIssueId.trim().toUpperCase() === linearUndoAfterDoneId ? (
            <div className="flex flex-wrap items-center gap-2 pt-2.5 mt-2 border-t border-white/[0.1]">
              <span className="text-[10px] text-sky-200/75 shrink-0">Marked Done · mistaken?</span>
              <button
                type="button"
                disabled={linearUndoBusy}
                aria-label={`Move ${resolvedLinearIssueId} back to In Review in Linear`}
                onClick={() => void undoLinearMarkedDone()}
                className="text-[11px] px-3 h-[28px] rounded-md bg-sky-500/22 hover:bg-sky-500/32 border border-sky-400/40 text-sky-50 disabled:opacity-45 disabled:pointer-events-none transition-colors"
              >
                {linearUndoBusy ? "Updating Linear…" : "Undo → In Review"}
              </button>
              <span className="text-[9.5px] text-white/32 leading-snug">
                Targets your board&apos;s review column when Linear accepts (
                <code className="mono text-white/45">state_target</code> in review).
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {loopUI.active && (
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/[0.06] px-3 py-1.5 flex items-center gap-2">
          <span className="relative flex">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping opacity-60" />
          </span>
          <span className="text-[12px] text-emerald-100/95 tracking-tight">
            Auto-loop active — iteration {loopUI.iter + 1} of {loopUI.max}, verify <code className="mono text-emerald-300/95">{loopUI.verify}</code>
          </span>
          <button
            onClick={() => endLoop("stopped by user", "info")}
            className="ml-auto text-[10.5px] px-2 h-[22px] rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-white/85"
          >
            Stop loop
          </button>
        </div>
      )}

      <MessageThread messages={messages} pending={askPending} />

      {/* Repo-aware tooling — only shown when there's a live repo. */}
      {active && (
        <>
          {SHOW_WORKSPACE_COMMAND_CARDS ? <CommandCards cards={cards} /> : null}

          {resultKind !== "idle" && (
            <ResultPanel
              kind={resultKind}
              loading={resultLoading}
              plan={plan}
              failure={failure}
              diff={diffSummary}
              onCopyCursorPrompt={copyCursorPrompt}
              onSendToCursor={sendToCursor}
              onSendToClaudeCli={sendToClaudeCli}
              onRunCommand={(cmd) => startCommand(cmd)}
              onOpenClaw={startOpenClawFromResult}
              openClawDisabled={!active || !repo?.ok || !!runId || resultLoading || starting}
            />
          )}

          <LiveAgentsPanel />

          <Terminal
            lines={lines}
            running={!!runId}
            command={runCommand}
            exitCode={exitCode}
            onCancel={cancelRun}
            onClear={clearTerminal}
          />

        </>
      )}

      {!active && (
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] px-3 py-2 text-[11.5px] text-white/55">
          Use <span className="text-white">My Tasks</span> below for agent briefs and Cursor handoff.{" "}
          <span className="text-white">Start Vmax</span> on a repo for plan checks, terminal runs, and in-panel results.
        </div>
      )}
    </div>
  );
}
