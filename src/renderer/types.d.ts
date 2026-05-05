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
};

export type FailureExplanation = {
  what: string;
  likelyFile: string | null;
  cause: string;
  next: string[];
  cursorPrompt: string;
};

export type DiffSummary = {
  summary: string;
  files: { path: string; change: string }[];
  risks: string[];
  nextChecks: string[];
};

declare global {
  interface Window {
    exec: {
      setInteractive: (on: boolean) => Promise<void>;
      openOverlay: () => Promise<void>;
      closeOverlay: () => Promise<void>;
      focusCommandCenter: () => Promise<void>;

      pillTranscript: (text: string) => Promise<void>;
      pillVoiceQuestion: (text: string) => Promise<void>;
      pillRequestCursor: () => Promise<void>;
      pillToggleScreen: () => Promise<void>;
      workspaceStatus: (status: { active?: boolean; busy?: boolean; recording?: boolean; screen?: boolean }) => Promise<void>;
      onPillTranscript: (cb: (text: string) => void) => () => void;
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
      getSettings: () => Promise<{ openaiApiKey: string; anthropicApiKey: string; cursorAutoSend: boolean; defaultProvider: "auto" | "openai" | "claude" }>;
      saveSettings: (s: Partial<{ openaiApiKey: string; anthropicApiKey: string; cursorAutoSend: boolean; defaultProvider: "auto" | "openai" | "claude" }>) => Promise<any>;
      listSessions: () => Promise<{ id: string; title: string; updatedAt: number; createdAt: number; repoName: string | null; repoPath: string | null }[]>;
      getSession: (id: string) => Promise<any | null>;
      saveSession: (s: any) => Promise<any>;
      deleteSession: (id: string) => Promise<void>;
      newSession: (seed?: { title?: string; repoPath?: string; repoName?: string }) => Promise<any>;

      isOnboarded: () => Promise<boolean>;
      finishOnboarding: () => Promise<void>;
      rememberRepo: (p: string) => Promise<void>;
      pickRepo: () => Promise<string | null>;
      scanRepo: (repoPath: string) => Promise<RepoContext>;
      openInCursor: (repoPath: string) => Promise<{ ok: boolean; via: "cli" | "open-a" | "url" | "finder" }>;
      copy: (text: string) => Promise<boolean>;
      sendToCursorChat: (p: { repoPath: string; prompt: string }) => Promise<{ ok: boolean; reason?: string; message?: string }>;

      run: (p: { runId: string; repoPath: string; command: string }) => Promise<{ started: boolean; blocked?: boolean; reason?: string }>;
      openclawAgent: (p: { runId: string; repoPath: string; message: string }) => Promise<{ started: boolean; error?: string }>;
      runClaudeCli: (p: { runId: string; repoPath: string; prompt: string }) => Promise<{ started: boolean }>;
      cancelRun: (runId: string) => Promise<boolean>;
      onRunData: (cb: (e: { runId: string; stream: "stdout" | "stderr"; chunk: string }) => void) => () => void;
      onRunEnd: (cb: (e: { runId: string; code: number; error?: string }) => void) => () => void;

      transcribe: (p: { audioBase64: string; mimeType: string }) => Promise<{ text: string }>;
      tts: (p: { text: string; voice?: string }) => Promise<{ audioBase64: string; mimeType: string }>;
      plan: (p: { task: string; repo: any; diff?: string; screenshotBase64?: string | null }) => Promise<Plan>;
      explainFailure: (p: { task: string; repo: any; command: string; output: string; screenshotBase64?: string | null }) => Promise<FailureExplanation>;
      summarizeDiff: (p: { diff: string }) => Promise<DiffSummary>;
    };
  }
}
