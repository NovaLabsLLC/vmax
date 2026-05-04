import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Launcher from "./components/Launcher";
import RepoStrip from "./components/RepoStrip";
import TaskPanel from "./components/TaskPanel";
import CommandCards from "./components/CommandCards";
import ResultPanel from "./components/ResultPanel";
import Terminal from "./components/Terminal";
import TalkBack, { Bubble } from "./components/TalkBack";
import type { RepoContext, Plan, FailureExplanation, DiffSummary } from "./types";

type ResultKind = "idle" | "plan" | "failure" | "diff";
type TermLine = { stream: "stdout" | "stderr" | "meta"; text: string };

export default function OverlayApp() {
  // session
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(true);
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

  // talkback
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const say = useCallback((text: string, tone: Bubble["tone"] = "info") => {
    setBubbles((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2), text, tone, ts: Date.now() },
    ]);
  }, []);

  // The Command Center stores the chosen repo before opening the overlay, so
  // we auto-activate as soon as the overlay mounts. If nothing is stored
  // (overlay was opened without going through the Command Center) the user
  // can still tap Start Exec on the idle card.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const last = await window.exec.getLastRepo();
      if (!cancelled && last) await activateWithRepo(last);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runIdRef = useRef<string | null>(null);
  const runCommandRef = useRef<string | null>(null);
  useEffect(() => { runIdRef.current = runId; }, [runId]);
  useEffect(() => { runCommandRef.current = runCommand; }, [runCommand]);

  useEffect(() => {
    const offData = window.exec.onRunData(({ runId: id, stream, chunk }) => {
      if (id !== runIdRef.current) return;
      lastRunOutputRef.current += chunk;
      setLines((prev) => [...prev, { stream, text: chunk }]);
    });
    const offEnd = window.exec.onRunEnd(({ runId: id, code, error }) => {
      if (id !== runIdRef.current) return;
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

      if (code !== 0 && active && finishedCmd) {
        say(`${finishedCmd} failed (exit ${code}). Looking at it…`, "warn");
        runExplainFailure(finishedCmd, finishedOutput);
      } else if (code === 0 && finishedCmd) {
        say(`${finishedCmd} passed.`, "success");
      }
    });
    return () => { offData(); offEnd(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ---- start / scan ----
  async function startExec() {
    if (active) return;
    setStarting(true);
    try {
      let p = repoPath || (await window.exec.getLastRepo());
      if (!p) {
        p = await window.exec.pickRepo();
        if (!p) { setStarting(false); return; }
      }
      await activateWithRepo(p);
    } finally {
      setStarting(false);
    }
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
    setExpanded(true);
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

  // ---- AI actions ----
  async function getDiffText(): Promise<string> {
    if (!repoPath) return "";
    return new Promise((resolve) => {
      const id = newRunId();
      let out = "";
      const offD = window.exec.onRunData((e) => { if (e.runId === id) out += e.chunk; });
      const offE = window.exec.onRunEnd((e) => {
        if (e.runId !== id) return;
        offD(); offE(); resolve(out);
      });
      window.exec.run({ runId: id, repoPath, command: "git diff" });
    });
  }

  async function runPlan() {
    if (!repo?.ok) return;
    if (!task.trim()) {
      say("Add a task first — paste from Linear or describe what to build.", "warn");
      return;
    }
    setResultKind("plan");
    setResultLoading(true);
    setPlan(null);
    say("Planning the task…");
    try {
      const diff = await getDiffText();
      const result = await window.exec.plan({ task, repo, diff });
      setPlan(result);
      say("Plan ready. Cursor prompt is queued.", "success");
    } catch (err) {
      say(`Plan failed: ${(err as Error).message}`, "warn");
      setResultKind("idle");
    } finally {
      setResultLoading(false);
    }
  }

  async function runSummarizeDiff() {
    if (!repo?.ok) return;
    setResultKind("diff");
    setResultLoading(true);
    setDiffSummary(null);
    say("Summarizing diff…");
    try {
      const diff = await getDiffText();
      const result = await window.exec.summarizeDiff({ diff });
      setDiffSummary(result);
      say("Diff summarized.", "success");
    } catch (err) {
      say(`Summarize failed: ${(err as Error).message}`, "warn");
      setResultKind("idle");
    } finally {
      setResultLoading(false);
    }
  }

  async function runExplainFailure(command: string, output: string) {
    if (!repo?.ok) return;
    setResultKind("failure");
    setResultLoading(true);
    setFailure(null);
    try {
      const result = await window.exec.explainFailure({ task, repo, command, output });
      setFailure(result);
      say("I have a guess — see the explanation above.", "success");
    } catch (err) {
      say(`Explain failed: ${(err as Error).message}`, "warn");
      setResultKind("idle");
    } finally {
      setResultLoading(false);
    }
  }

  // ---- terminal ----
  function newRunId() { return "r-" + Math.random().toString(36).slice(2, 10); }

  function startCommand(command: string) {
    if (!repoPath) return;
    if (runIdRef.current) return;
    const id = newRunId();
    runIdRef.current = id;
    runCommandRef.current = command;
    lastRunOutputRef.current = "";
    setRunId(id);
    setRunCommand(command);
    setExitCode(null);
    setLines((prev) => [...prev, { stream: "meta", text: `\n$ ${command}\n` }]);
    window.exec.run({ runId: id, repoPath, command });
  }

  function cancelRun() { if (runId) window.exec.cancelRun(runId); }
  function clearTerminal() {
    setLines([]); setExitCode(null); setRunCommand(null);
  }

  // ---- cards ----
  const cards = useMemo(() => [
    {
      key: "plan",
      title: "Plan Task",
      hint: "Tactical plan + Cursor prompt",
      enabled: active && repo?.ok === true && !resultLoading,
      loading: resultLoading && resultKind === "plan",
      onClick: runPlan,
    },
    {
      key: "typecheck",
      title: "Typecheck",
      hint: "npm run typecheck",
      enabled: active && repo?.ok === true && !runId,
      loading: !!runId && runCommand === "npm run typecheck",
      onClick: () => startCommand("npm run typecheck"),
    },
    {
      key: "tests",
      title: "Tests",
      hint: "npm test",
      enabled: active && repo?.ok === true && !runId,
      loading: !!runId && runCommand === "npm test",
      onClick: () => startCommand("npm test"),
    },
    {
      key: "diff",
      title: "Summarize Diff",
      hint: "git diff → summary",
      enabled: active && repo?.ok === true && !resultLoading,
      loading: resultLoading && resultKind === "diff",
      onClick: runSummarizeDiff,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [active, repo, resultLoading, resultKind, runId, runCommand]);

  // ---- handoff ----
  async function copyCursorPrompt(prompt: string) {
    await window.exec.copy(prompt);
    say("Prompt copied. Paste into Cursor.", "success");
  }
  async function sendToCursor(prompt: string) {
    if (!repoPath) {
      await window.exec.copy(prompt);
      return;
    }
    say("Opening Cursor and sending prompt…");
    const r = await window.exec.sendToCursorChat({ repoPath, prompt });
    if (r.ok) {
      say("Sent to Cursor's chat.", "success");
      return;
    }
    if (r.reason === "accessibility") {
      say(
        "Need Accessibility permission to drive Cursor. Grant it to Electron in System Settings → Privacy → Accessibility, then quit and run again. Prompt is on your clipboard.",
        "warn"
      );
      return;
    }
    say(
      `Couldn't auto-send (${r.reason || "unknown"}). Prompt is on your clipboard — paste it into Cursor.`,
      "warn"
    );
  }

  // ---- click-through: window is click-through unless pointer is over our UI ----
  const hoverProps = {
    onMouseEnter: () => window.exec.setInteractive(true),
    onMouseLeave: () => window.exec.setInteractive(false),
  };

  const showTerminal = lines.length > 0 || !!runId;

  return (
    <div className="w-full h-full flex flex-col justify-end items-stretch pointer-events-none">
      {/* Floating terminal sheet — animates in/out smoothly */}
      <div
        className={`mx-auto w-[min(560px,92vw)] origin-bottom transition-all duration-300 ease-out
          ${active && expanded && showTerminal
            ? "opacity-100 translate-y-0 scale-100 mb-2 pointer-events-auto"
            : "opacity-0 translate-y-2 scale-[0.98] mb-0 max-h-0 overflow-hidden pointer-events-none"}`}
        {...(active && expanded && showTerminal ? hoverProps : {})}
      >
        <Terminal
          lines={lines}
          running={!!runId}
          command={runCommand}
          exitCode={exitCode}
          onCancel={cancelRun}
          onClear={clearTerminal}
        />
      </div>

      {/* Main card — animates expand/collapse */}
      <div
        className={`mx-auto w-[min(560px,92vw)] origin-bottom transition-all duration-300 ease-out
          ${expanded
            ? "opacity-100 translate-y-0 scale-100 mb-2 pointer-events-auto"
            : "opacity-0 translate-y-3 scale-[0.97] mb-0 max-h-0 overflow-hidden pointer-events-none"}`}
        {...(expanded ? hoverProps : {})}
      >
        <div className="relative rounded-[22px] overflow-hidden
                        ring-1 ring-white/10
                        shadow-[0_28px_70px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.02)_inset]
                        backdrop-blur-2xl">
          <div className="absolute inset-0 -z-10 bg-[#08080a]/88" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
          <span className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

          <div className="p-3 max-h-[420px] overflow-y-auto term-scroll space-y-2.5">
            {!active ? (
              <IdleCard onStart={startExec} busy={starting} task={task} onTaskChange={setTask} />
            ) : (
              <>
                <RepoStrip repo={repo} onRescan={rescan} />
                <TaskPanel
                  task={task}
                  onTaskChange={setTask}
                  onSend={runPlan}
                  sending={resultLoading && resultKind === "plan"}
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
                    onRunCommand={(cmd) => startCommand(cmd)}
                  />
                )}
                <TalkBack bubbles={bubbles} />
              </>
            )}
          </div>
        </div>
      </div>

      <Launcher
        active={active}
        busy={starting}
        repoName={repo?.ok ? repo.name : null}
        branch={repo?.ok ? repo.branch : null}
        onStart={startExec}
        onChangeRepo={changeRepo}
        onClose={() => setExpanded((v) => !v)}
        expanded={expanded}
        onMouseEnter={hoverProps.onMouseEnter}
        onMouseLeave={hoverProps.onMouseLeave}
      />
    </div>
  );
}

function IdleCard({
  onStart,
  busy,
  task,
  onTaskChange,
}: {
  onStart: () => void;
  busy: boolean;
  task: string;
  onTaskChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 px-1 pt-1">
        <div className="w-7 h-7 rounded-md bg-white text-black flex items-center justify-center text-[12px] font-bold">E</div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-white tracking-tight">Exec</div>
          <div className="text-[10.5px] text-white/45 leading-tight">control layer for coding agents</div>
        </div>
      </div>

      <p className="text-[12px] text-white/65 leading-relaxed px-1">
        One button starts an AI control layer. It sees your repo and task, plans, runs checks,
        explains failures, and tells Cursor exactly what to do next.
      </p>

      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 mb-1">Task (optional — paste now or after start)</div>
        <textarea
          value={task}
          onChange={(e) => onTaskChange(e.target.value)}
          placeholder="Add RevenueCat paywall flow"
          rows={2}
          className="w-full bg-transparent outline-none border-none resize-none
                     text-[13px] text-white placeholder-white/30 leading-relaxed"
        />
      </div>

      <button
        onClick={onStart}
        disabled={busy}
        className={`w-full h-10 rounded-xl text-[13px] font-medium tracking-tight
                    transition-all
                    bg-white text-black hover:bg-white/90
                    shadow-[0_0_24px_-4px_rgba(255,255,255,0.45)]
                    ${busy ? "opacity-60 cursor-wait" : ""}`}
      >
        {busy ? "Starting…" : "Start Exec"}
      </button>

      <div className="text-[10.5px] text-white/35 px-1 leading-relaxed">
        First run picks a repo. After that, Start Exec re-uses the last repo.
      </div>
    </div>
  );
}
