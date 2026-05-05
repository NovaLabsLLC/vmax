import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RepoStrip from "../components/RepoStrip";
import ActivityBar, { Activity } from "../components/ActivityBar";
import TaskPanel from "../components/TaskPanel";
import CommandCards from "../components/CommandCards";
import ResultPanel from "../components/ResultPanel";
import Terminal from "../components/Terminal";
import TalkBack, { Bubble } from "../components/TalkBack";
import type { RepoContext, Plan, FailureExplanation, DiffSummary } from "../types";
import { buildOpenClawAgentMessage } from "../utils/openClawPrompt";

type ResultKind = "idle" | "plan" | "failure" | "diff";
type TermLine = { stream: "stdout" | "stderr" | "meta"; text: string };

type Props = {
  pendingVoiceQuestion?: string | null;
  onConsumeVoiceQuestion?: () => void;
  getScreenshot?: () => string | null;
  screenStatus?: "idle" | "requesting" | "granted" | "denied";
  onStartScreen?: () => void;
  onStopScreen?: () => void;
  activeSessionId?: string | null;
  onSessionChange?: (id: string | null) => void;
};

export default function WorkspacePanel({
  pendingVoiceQuestion,
  onConsumeVoiceQuestion,
  getScreenshot,
  screenStatus,
  onStartScreen,
  onStopScreen,
  activeSessionId,
  onSessionChange,
}: Props = {}) {
  // session
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [repo, setRepo] = useState<RepoContext | null>(null);

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

  // bubbles
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const say = useCallback((text: string, tone: Bubble["tone"] = "info") => {
    setBubbles((prev) => [...prev, { id: Math.random().toString(36).slice(2), text, tone, ts: Date.now() }]);
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
  function endLoop(reason: string, tone: Bubble["tone"] = "info") {
    if (!loopRef.current.active) return;
    setLoop({ ...loopRef.current, active: false });
    say(`Auto-loop ended: ${reason}.`, tone);
  }
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const speakGenRef = useRef(0);
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

  // ---- voice output ----
  async function speak(text: string) {
    if (!text) return;
    const cleaned = text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/[*_`#>]/g, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*[-•]\s+/gm, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .trim();
    if (!cleaned) return;
    const gen = ++speakGenRef.current;
    const captionUi = cleaned.length > 220 ? `${cleaned.slice(0, 217)}…` : cleaned;
    try {
      audioPlayerRef.current?.pause();
      const { audioBase64, mimeType } = await window.exec.tts({ text: cleaned, voice: "nova" });
      if (speakGenRef.current !== gen) return;
      void window.exec.publishVoiceCaption({ assistant: captionUi });
      const blob = b64ToBlob(audioBase64, mimeType);
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      const clearCaption = () => {
        if (speakGenRef.current === gen) void window.exec.publishVoiceCaption({ assistant: null });
      };
      a.onended = () => {
        URL.revokeObjectURL(url);
        clearCaption();
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
        clearCaption();
      };
      audioPlayerRef.current = a;
      await a.play();
    } catch (err) {
      if (speakGenRef.current === gen) void window.exec.publishVoiceCaption({ assistant: null });
      console.error("TTS failed", err);
    }
  }
  function b64ToBlob(b64: string, mime: string): Blob {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
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
        if (code === 125 && finishedCmd) {
          endActivity({ tone: "err", text: "OpenClaw blocked" });
          say(error || "OpenClaw run was blocked.", "warn");
        } else if (code !== 0 && finishedCmd) {
          endActivity({ tone: "err", text: "OpenClaw error" });
          say("OpenClaw exited with an error — full output is in the terminal.", "warn");
        } else if (code === 0 && finishedCmd) {
          endActivity({ tone: "ok", text: "OpenClaw completed" });
          say("OpenClaw finished — scroll the terminal for the agent reply.", "success");
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
  // task / plan / failure / diff / bubbles into the workspace. If no session
  // is active, fall back to the last-used repo (legacy behavior).
  const loadedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (activeSessionId && activeSessionId !== loadedSessionRef.current) {
        const s = await window.exec.getSession(activeSessionId);
        if (cancelled || !s) return;
        loadedSessionRef.current = activeSessionId;
        setTask(s.task || "");
        setPlan(s.plan || null);
        setFailure(s.failure || null);
        setDiffSummary(s.diffSummary || null);
        setBubbles(Array.isArray(s.bubbles) ? s.bubbles : []);
        setResultKind(s.plan ? "plan" : s.failure ? "failure" : s.diffSummary ? "diff" : "idle");
        if (s.repoPath) {
          await activateWithRepo(s.repoPath);
        } else {
          const last = await window.exec.getLastRepo();
          if (!cancelled && last) await activateWithRepo(last);
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
    if (!active) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      saveTimerRef.current = null;
      let id = activeSessionId;
      const titleFromTask = (task.trim().split(/\n/)[0] || "").slice(0, 80) || "New chat";
      if (!id) {
        // Don't create empty sessions — wait until there's actual content.
        const hasContent = task.trim() || plan || failure || diffSummary || bubbles.length;
        if (!hasContent) return;
        const seed = await window.exec.newSession({
          title: titleFromTask,
          repoPath: repoPath || undefined,
          repoName: repo?.ok ? repo.name : undefined,
        });
        id = seed.id;
        loadedSessionRef.current = id;
        onSessionChange?.(id);
      }
      // Update the title if the task line changed.
      const title = titleFromTask !== lastTitleRef.current ? titleFromTask : undefined;
      if (title) lastTitleRef.current = title;
      await window.exec.saveSession({
        id,
        title: title || undefined,
        task,
        plan,
        failure,
        diffSummary,
        bubbles: bubbles.slice(-60),
        repoPath: repoPath || null,
        repoName: repo?.ok ? repo.name : null,
      });
    }, 600);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, plan, failure, diffSummary, bubbles, active, repoPath]);

  // ---- pill bus ----
  const taskRef = useRef(task);
  useEffect(() => { taskRef.current = task; }, [task]);

  // Voice question lifted up to CommandCenter so it isn't lost when the
  // workspace tab isn't mounted. Process it here once the workspace has a
  // live repo (auto-activate runs on mount via getLastRepo).
  useEffect(() => {
    if (!pendingVoiceQuestion) return;
    if (!repo?.ok) return; // wait for activation
    const text = pendingVoiceQuestion;
    onConsumeVoiceQuestion?.();
    setTask(text);
    taskRef.current = text;
    say(`You asked: "${text}". Thinking…`);
    runPlan(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVoiceQuestion, repo]);

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
    return () => { offT(); offC(); };
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
  async function rescan() {
    if (!repoPath) return;
    const ctx = await window.exec.scanRepo(repoPath);
    setRepo(ctx);
    if (ctx.ok) say("Rescanned repo.");
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
    const t = (taskOverride ?? taskRef.current ?? task).trim();
    if (!t) { say("Add a task first — paste from Linear or describe what to build.", "warn"); return; }
    setResultKind("plan"); setResultLoading(true); setPlan(null);
    beginActivity("plan", "Planning the task…");
    say("Planning the task…");
    try {
      bumpActivityLabel("Gathering git diff…");
      const diff = await getDiffText();
      bumpActivityLabel("Calling AI (Claude / OpenAI)…");
      const screenshotBase64 = getScreenshot?.() || null;
      const result = await window.exec.plan({ task: t, repo, diff, screenshotBase64 });
      setPlan(result);
      endActivity({ tone: "ok", text: "Plan ready" });
      say("Plan ready. Cursor prompt is queued.", "success");
      speak(result.summary);
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
      const result = await window.exec.explainFailure({ task, repo, command, output, screenshotBase64 });
      setFailure(result);
      endActivity({ tone: "ok", text: "Diagnosis ready" });
      say("I have a guess — see the explanation above.", "success");
      speak(`${result.what}. ${result.cause}`);

      // Auto-loop continuation: if we're inside a Claude Code loop and we got
      // a fix prompt back, fire the next iteration. Stop once we hit max.
      if (loopRef.current.active && result.cursorPrompt) {
        const next = loopRef.current.iter + 1;
        if (next > loopRef.current.max) {
          endLoop(`hit max iterations (${loopRef.current.max})`, "warn");
        } else {
          setLoop({ ...loopRef.current, iter: next });
          say(`Loop ${next}/${loopRef.current.max} — sending fix to Claude…`);
          window.setTimeout(() => sendToClaudeCli(result.cursorPrompt), 350);
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

  // cards
  const cards = useMemo(() => [
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [active, repo, resultLoading, resultKind, runId, runCommand]);

  // handoff
  async function copyCursorPrompt(prompt: string) {
    await window.exec.copy(prompt);
    say("Prompt copied. Paste into Cursor.", "success");
  }

  // Run the generated prompt with Claude Code CLI inside the active repo.
  // Reuses startCommand's runId / streaming / activity wiring so the terminal
  // panel and ActivityBar light up automatically — UI never freezes.
  function sendToClaudeCli(prompt: string) {
    if (!repoPath) { say("No active repo for Claude Code CLI.", "warn"); return; }
    if (runIdRef.current) {
      say("Wait for the current run to finish before starting Claude Code.", "warn");
      return;
    }
    // Arm the auto-loop on the first hand-off if the plan came with a verify
    // command. Subsequent iterations re-use the same loop state.
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
    window.exec.runClaudeCli({ runId: id, repoPath, prompt }).catch((err) => {
      say(`Claude Code failed to start: ${(err as Error).message}`, "warn");
    });
  }
  async function sendToCursor(prompt: string) {
    if (!repoPath) { await window.exec.copy(prompt); return; }
    beginActivity("cursor", "Handoff to Cursor (Claude Code)…");
    say("Opening Cursor and sending prompt…");
    const r = await window.exec.sendToCursorChat({ repoPath, prompt });
    if (r.ok) {
      endActivity({ tone: "ok", text: "Sent to Cursor" });
      say("Sent to Cursor's chat.", "success");
    } else if (r.reason === "accessibility") {
      endActivity({ tone: "err", text: "Cursor blocked: Accessibility" });
      say("Need Accessibility permission to drive Cursor. Grant in System Settings → Privacy → Accessibility, then quit and run again. Prompt is on your clipboard.", "warn");
    } else {
      endActivity({ tone: "err", text: "Cursor handoff failed" });
      say(`Couldn't auto-send (${r.reason || "unknown"}). Prompt is on your clipboard.`, "warn");
    }
  }

  return (
    <div className="max-w-[820px] mx-auto px-6 pt-6 pb-12 space-y-3">
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
            {starting ? "Starting…" : "Start Exec"}
          </button>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={async () => {
                const s = await window.exec.newSession({
                  repoPath: repoPath || undefined,
                  repoName: repo?.ok ? repo.name : undefined,
                });
                // clear local state for the new chat
                setTask(""); setPlan(null); setFailure(null); setDiffSummary(null);
                setBubbles([]); setResultKind("idle"); setLines([]);
                lastTitleRef.current = "";
                loadedSessionRef.current = s.id;
                onSessionChange?.(s.id);
              }}
              className="h-9 px-3 rounded-lg text-[12px] text-white/85 hover:text-white
                         bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.10]"
            >
              + New chat
            </button>
            <button
              onClick={changeRepo}
              className="h-9 px-3 rounded-lg text-[12px] text-white/75 hover:text-white
                         bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08]"
            >
              Change repo
            </button>
          </div>
        )}
      </div>

      {active && (
        <>
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
            <RepoStrip repo={repo} onRescan={rescan} />
          </div>

          <ActivityBar activity={activity} resultFlash={lastResultStatus} />

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

          <TaskPanel
            task={task}
            onTaskChange={setTask}
            onSend={runPlan}
            onTranscribed={() => say("Got it — I heard you.")}
            onVoiceError={(m) => say(m, "warn")}
            sending={resultLoading}
            disabled={!active}
          />

          <CommandCards cards={cards} />

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

          <Terminal
            lines={lines}
            running={!!runId}
            command={runCommand}
            exitCode={exitCode}
            onCancel={cancelRun}
            onClear={clearTerminal}
          />

          <TalkBack bubbles={bubbles} />
        </>
      )}

      {!active && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="text-[13px] text-white/65 leading-relaxed">
            Hit <span className="text-white font-medium">Start Exec</span> to load the active repo. The pill
            on your screen gives you quick voice / screen / Cursor controls — everything else lives here.
          </div>
        </div>
      )}
    </div>
  );
}
