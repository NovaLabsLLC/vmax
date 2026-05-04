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
      getRecentRepos: () => Promise<string[]>;
      getLastRepo: () => Promise<string | null>;

      getProfile: () => Promise<{ name?: string; email?: string; role?: string } | null>;
      saveProfile: (p: { name?: string; email?: string; role?: string }) => Promise<{ name?: string; email?: string; role?: string }>;
      getSettings: () => Promise<{ openaiApiKey: string; anthropicApiKey: string; cursorAutoSend: boolean; defaultProvider: "auto" | "openai" | "claude" }>;
      saveSettings: (s: Partial<{ openaiApiKey: string; anthropicApiKey: string; cursorAutoSend: boolean; defaultProvider: "auto" | "openai" | "claude" }>) => Promise<any>;
      isOnboarded: () => Promise<boolean>;
      finishOnboarding: () => Promise<void>;
      rememberRepo: (p: string) => Promise<void>;
      pickRepo: () => Promise<string | null>;
      scanRepo: (repoPath: string) => Promise<RepoContext>;
      openInCursor: (repoPath: string) => Promise<{ ok: boolean; via: "cli" | "open-a" | "url" | "finder" }>;
      copy: (text: string) => Promise<boolean>;
      sendToCursorChat: (p: { repoPath: string; prompt: string }) => Promise<{ ok: boolean; reason?: string; message?: string }>;

      run: (p: { runId: string; repoPath: string; command: string }) => Promise<{ started: boolean }>;
      cancelRun: (runId: string) => Promise<boolean>;
      onRunData: (cb: (e: { runId: string; stream: "stdout" | "stderr"; chunk: string }) => void) => () => void;
      onRunEnd: (cb: (e: { runId: string; code: number; error?: string }) => void) => () => void;

      plan: (p: { task: string; repo: any; diff?: string }) => Promise<Plan>;
      explainFailure: (p: { task: string; repo: any; command: string; output: string }) => Promise<FailureExplanation>;
      summarizeDiff: (p: { diff: string }) => Promise<DiffSummary>;
    };
  }
}
