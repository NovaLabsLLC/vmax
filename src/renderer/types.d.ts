export {};

export type RepoContext = {
  ok: true;
  root: string;
  name: string;
  branch: string;
  changedFiles: string[];
  status: string[];
  diffStat: string;
} | { ok: false; error: string };

export type Plan = {
  summary: string;
  files: { path: string; why: string }[];
  risks: string[];
  command: string;
  cursorPrompt: string;
  claudePrompt?: string;
  whatVmaxSees?: string;
  nextStepsStructured?: string[];
  executionRecommendation?: string;
  /** Short TTS line from the model (1–2 sentences). */
  speakableSummary?: string;
  /** True when Zod validation failed — UI may show a banner */
  parseWarning?: boolean;
};

export type FailureExplanation = {
  what: string;
  likelyFile: string | null;
  cause: string;
  next: string[];
  cursorPrompt: string;
  claudePrompt?: string;
  whatVmaxSees?: string;
  suggestedCommands?: string[];
  executionRecommendation?: string;
  speakableSummary?: string;
  parseWarning?: boolean;
};

export type DiffSummary = {
  summary: string;
  files: { path: string; change: string }[];
  risks: string[];
  nextChecks: string[];
  cursorPrompt?: string;
  claudePrompt?: string;
  whatVmaxSees?: string;
  nextStepsStructured?: string[];
  executionRecommendation?: string;
  speakableSummary?: string;
  parseWarning?: boolean;
};

/** Structured Ask / voice answer for the floating Vmax panel. */
export type VmaxPanelPayload = {
  summary: string;
  whatVmaxSees: string;
  likelyProblem: string;
  nextSteps: string[];
  cursorPrompt: string;
  claudePrompt: string;
  suggestedCommands: string[];
  speakableSummary?: string;
  executionRecommendation?: string;
};

/** Linear workspace row surfaced by main-process IPC — identifiers + preview only. */
export type LinearWorkspacePreview = {
  id: string;
  label: string;
  workspace_name: string;
  workspace_url_key: string;
  viewer_name: string;
  viewer_email: string;
  added_at: number;
  key_preview: string;
};

export type VmaxPanelAction =
  | { type: "send-cursor"; prompt: string }
  | { type: "run-claude"; prompt: string }
  | { type: "openclaw"; question: string; panel: VmaxPanelPayload }
  | { type: "run-command"; command: string };

export type VmaxTaskType =
  | "bug_fix"
  | "feature"
  | "refactor"
  | "test"
  | "investigation"
  | "ui_change"
  | "infra";

export type VmaxTaskPriority = "low" | "medium" | "high";
export type VmaxTaskRisk = "low" | "medium" | "high";
export type VmaxTaskAgent = "claude_code" | "cursor" | "codex" | "manual";

export type VmaxTask = {
  id: string;
  title: string;
  goal: string;
  repo: {
    name: string;
    path: string;
    baseBranch: string;
    targetBranch: string;
  };
  type: VmaxTaskType;
  priority: VmaxTaskPriority;
  filesToInspect: string[];
  constraints: string[];
  successCriteria: string[];
  validationCommands: string[];
  riskLevel: VmaxTaskRisk;
  approvalPolicy: { requireApprovalBefore: string[] };
  agent: { preferred: VmaxTaskAgent; reason: string };
  outputFormat: string[];
};

export type VmaxTaskCreateResult =
  | { ok: true; task: VmaxTask }
  | { ok: false; task?: VmaxTask; parseWarning?: boolean; error?: string };

export type VmaxTaskStatus =
  | "created"
  | "routed"
  | "triggered"
  | "running"
  | "completed"
  | "failed";

export type VmaxTaskRunRecord = {
  taskId: string;
  task: VmaxTask;
  selectedAgent: ExecAgent | null;
  routingReason: string;
  promptPayload: string;
  status: VmaxTaskStatus;
  error: string | null;
  runId: string | null;
  code: number | null;
  createdAt: number;
  updatedAt: number;
};

export type VmaxTaskTriggerRunBrief = {
  runId?: string | null;
  selectedAgent?: ExecAgent | null;
  routingReason?: string;
  status?: VmaxTaskStatus;
};

export type VmaxTaskTriggerResult = {
  ok: boolean;
  taskId?: string;
  selectedAgent?: ExecAgent | null;
  routingReason?: string;
  status?: VmaxTaskStatus;
  runId?: string;
  runs?: VmaxTaskTriggerRunBrief[];
  error?: string;
};

export type ExecAgent = "claude" | "codex" | "cursor";
export type AgentRunState = "idle" | "running" | "done" | "error";
export type AgentStatusEvent = {
  agent: ExecAgent;
  state: AgentRunState;
  runId: string;
  prompt?: string;
  reason?: string;
  code?: number;
  error?: string;
};

export type VmaxOverlayBroadcast =
  | { phase: "loading"; question?: string }
  | { phase: "ready"; question: string; panel: VmaxPanelPayload; parseWarning?: boolean }
  | { phase: "error"; message: string };

declare global {
  interface Window {
    exec: {
      setInteractive: (on: boolean) => Promise<void>;
      openOverlay: () => Promise<void>;
      closeOverlay: () => Promise<void>;
      focusCommandCenter: (opts?: { view?: "home" | "workspace" | "chats" | "profile" | "settings" | "help" | "agents" }) => Promise<void>;
      onCcNavigate: (cb: (p: { view?: string }) => void) => () => void;

      pillInterruptSpeech: () => Promise<void>;
      pillTranscript: (text: string) => Promise<void>;
      pillVoiceQuestion: (text: string) => Promise<void>;
      pillRequestCursor: () => Promise<void>;
      pillToggleScreen: () => Promise<void>;
      workspaceStatus: (status: { active?: boolean; busy?: boolean; recording?: boolean; screen?: boolean }) => Promise<void>;
      workspaceSpeaking: (speaking: boolean) => Promise<void>;
      onWorkspaceSpeaking: (cb: (speaking: boolean) => void) => () => void;
      onPillTranscript: (cb: (text: string) => void) => () => void;
      onPillInterruptSpeech: (cb: () => void) => () => void;
      onPillVoiceQuestion: (cb: (text: string) => void) => () => void;
      onCaptionDirection: (cb: (dir: "above" | "below") => void) => () => void;
      onPillRequestCursor: (cb: () => void) => () => void;
      onPillToggleScreen: (cb: () => void) => () => void;
      onWorkspaceStatus: (cb: (s: { active?: boolean; busy?: boolean; recording?: boolean; screen?: boolean }) => void) => () => void;
      setOverlayCaptionOpen: (open: boolean) => Promise<void>;
      setOverlayCaptionOpenSync: (open: boolean) => void;
      publishVoiceCaption: (p: { assistant?: string | null }) => Promise<void>;
      onVoiceCaption: (cb: (p: { assistant?: string | null }) => void) => () => void;
      getRecentRepos: () => Promise<string[]>;
      getLastRepo: () => Promise<string | null>;

      getProfile: () => Promise<{ name?: string; email?: string; role?: string } | null>;
      saveProfile: (p: { name?: string; email?: string; role?: string }) => Promise<{ name?: string; email?: string; role?: string }>;
      getSettings: () => Promise<{
        openaiApiKey: string;
        anthropicApiKey: string;
        cursorAutoSend: boolean;
        defaultProvider: "auto" | "openai" | "claude";
        talkBack: boolean;
      }>;
      saveSettings: (s: Partial<{
        openaiApiKey: string;
        anthropicApiKey: string;
        cursorAutoSend: boolean;
        defaultProvider: "auto" | "openai" | "claude";
        talkBack: boolean;
      }>) => Promise<any>;
      onSettingsUpdated: (cb: (s: { openaiApiKey?: string; anthropicApiKey?: string; cursorAutoSend?: boolean; defaultProvider?: string; talkBack?: boolean }) => void) => () => void;
      linearWorkspacesList: () => Promise<{
        workspaces: LinearWorkspacePreview[];
        count: number;
      }>;
      linearWorkspacesAdd: (
        payload: { apiKey: string; label: string },
      ) => Promise<
        | { ok: true; workspace: LinearWorkspacePreview }
        | { ok: false; error: string }
      >;
      linearWorkspacesRemove: (id: string) => Promise<{ ok: true } | { ok: false; error?: string }>;
      linearWorkspacesRename: (
        id: string,
        label: string,
      ) =>
        Promise<
          { ok: true; workspace: LinearWorkspacePreview } | { ok: false; error?: string }
        >;
      onLinearWorkspacesChanged: (cb: () => void) => () => void;
      listSessions: () => Promise<{ id: string; title: string; updatedAt: number; createdAt: number; repoName: string | null; repoPath: string | null }[]>;
      getSession: (id: string) => Promise<any | null>;
      saveSession: (s: any) => Promise<any>;
      deleteSession: (id: string) => Promise<void>;
      clearSessions: () => Promise<{ ok: boolean }>;
      newSession: (seed?: { title?: string; repoPath?: string; repoName?: string }) => Promise<any>;
      onSessionsUpdated: (cb: () => void) => () => void;

      isOnboarded: () => Promise<boolean>;
      finishOnboarding: () => Promise<void>;
      rememberRepo: (p: string) => Promise<void>;
      pickRepo: () => Promise<string | null>;
      scanRepo: (repoPath: string) => Promise<RepoContext>;
      openInCursor: (repoPath: string) => Promise<{ ok: boolean; via: "cli" | "open-a" | "url" | "finder" }>;
      copy: (text: string) => Promise<boolean>;
      sendToCursorChat: (p: { repoPath: string; prompt: string }) => Promise<{
        ok: boolean;
        reason?: string;
        message?: string;
        openedRepoVia?: "cursor-cli" | "open-app" | "none";
        pastedVia?: "applescript" | "clipboard-only";
        automationFailed?: boolean;
        pasteShortcut?: string;
      }>;

      cliStatus: () => Promise<{
        claude: { installed: boolean; version?: string; authed?: boolean; authVia?: "env" | "file" };
        codex: { installed: boolean; version?: string; authed?: boolean; authVia?: "env" | "file" };
      }>;
      cliOpenLogin: (tool: "claude" | "codex") => Promise<{ ok: boolean; error?: string }>;
      cliOpenInstall: (tool: "claude" | "codex") => Promise<{ ok: boolean; error?: string }>;

      run: (p: { runId: string; repoPath: string; command: string }) => Promise<{ started: boolean; blocked?: boolean; reason?: string }>;
      openclawAgent: (p: { runId: string; repoPath: string; message: string }) => Promise<{ started: boolean; error?: string }>;
      runClaudeCli: (p: { runId: string; repoPath: string; prompt: string }) => Promise<{ started: boolean; error?: string }>;
      runCodexCli: (p: { runId: string; repoPath: string; prompt: string }) => Promise<{ started: boolean; error?: string }>;
      dispatch: (
        payload: {
          prompt?: string;
          agent?: ExecAgent;
          agentPrompts?: { agent: ExecAgent; prompt: string; reason?: string }[];
        },
      ) => Promise<
        | { ok: false; error: string }
        | {
          ok: true;
          mode?: "single" | "multi";
          agent?: ExecAgent | string;
          reason?: string;
          runId?: string;
          runs?: { agent: ExecAgent | string; reason?: string; runId: string }[];
        }
      >;
      onAgentsStatus: (cb: (p: AgentStatusEvent) => void) => () => void;
      cancelRun: (runId: string) => Promise<boolean>;
      onRunData: (cb: (e: { runId: string; stream: "stdout" | "stderr"; chunk: string }) => void) => () => void;
      onRunEnd: (cb: (e: { runId: string; code: number; error?: string }) => void) => () => void;

      publishVmaxResponse: (p: VmaxOverlayBroadcast) => Promise<boolean>;
      onVmaxResponse: (cb: (p: VmaxOverlayBroadcast) => void) => () => void;
      setOverlayExpanded: (expanded: boolean) => Promise<boolean>;
      setOverlayContentHeight: (height: number) => Promise<boolean>;
      setOverlayToolbarWidth: (width: number) => Promise<boolean>;
      setOverlayBounds: (opts: { width: number; height: number; animate?: boolean }) => Promise<boolean>;
      openUrl: (url: string) => Promise<boolean>;
      vmaxPanelAction: (p: VmaxPanelAction) => Promise<boolean>;
      onVmaxPanelAction: (cb: (p: VmaxPanelAction) => void) => () => void;

      transcribe: (p: { audioBase64: string; mimeType: string }) => Promise<{ text: string }>;
      tts: (p: { text: string; voice?: string; instructions?: string }) => Promise<{ audioBase64: string; mimeType: string }>;
      ask: (p: {
        question: string;
        screenshotBase64?: string | null;
        repo?: any;
        repoContextSummary?: string | null;
        history?: { role: "user" | "assistant"; text: string }[];
      }) => Promise<{
        text: string;
        structured: VmaxPanelPayload;
        parseWarning: boolean;
      }>;
      createProject: (p: { name: string; parentDir?: string }) => Promise<{ ok: boolean; path: string; name: string }>;
      plan: (p: {
        task: string;
        repo: any;
        diff?: string;
        screenshotBase64?: string | null;
        repoContextSummary?: string | null;
      }) => Promise<Plan>;
      taskCreate: (p: { prompt: string; repo?: any; targetBranch?: string; repoContextSummary?: string | null }) => Promise<VmaxTaskCreateResult>;
      taskTrigger: (p: {
        task: VmaxTask;
        agents?: ExecAgent[];
        repoPath?: string | null;
        repoSummary?: string | null;
        /** When exactly two agents are selected, Workspace can send trimmed overrides per runner. Empty fields fall back to the shared structured payload. */
        promptByAgent?: Partial<Record<ExecAgent, string>>;
      }) => Promise<VmaxTaskTriggerResult>;
      taskGet: (taskId: string) => Promise<VmaxTaskRunRecord | null>;
      taskList: () => Promise<VmaxTaskRunRecord[]>;
      /** Local aggregates in `exec-usage.json` — no prompts stored. */
      getUsageSummary: () => Promise<{
        updatedAt: number;
        totals: Record<string, number>;
        byAgent: Record<string, number>;
      }>;
      taskCancel: (taskId: string) => Promise<boolean>;
      onTaskStatus: (cb: (r: VmaxTaskRunRecord) => void) => () => void;
      explainFailure: (p: {
        task: string;
        repo: any;
        command: string;
        output: string;
        screenshotBase64?: string | null;
        repoContextSummary?: string | null;
      }) => Promise<FailureExplanation>;
      summarizeDiff: (p: { diff: string }) => Promise<DiffSummary>;
    };
  }
}
