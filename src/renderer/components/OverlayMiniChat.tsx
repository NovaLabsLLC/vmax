import React, { useCallback, useEffect, useRef, useState } from "react";
import type { RepoContext } from "../types";
import { deriveSpeakable, toSpeakableLine } from "../utils/talkBackText";

type ChatMsg = { role: "user" | "assistant"; text: string; ts: number };

function parseAskActionTag(text: string): { prose: string } {
  if (!text) return { prose: "" };
  const m = text.match(/\[\[action\s+[a-z-]+[^\]]*\]\]/i);
  if (!m) return { prose: text };
  return { prose: text.replace(m[0], "").trim() };
}

async function ensureRepoContext(repoRef: React.MutableRefObject<RepoContext | undefined>): Promise<void> {
  if (repoRef.current?.ok) return;
  const path = await window.exec.getLastRepo();
  if (!path) {
    repoRef.current = { ok: false, error: "no-repo" };
    return;
  }
  repoRef.current = await window.exec.scanRepo(path);
}

function useOverlaySpeak(talkBack: boolean) {
  const genRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(
    (raw: string) => {
      if (!talkBack || !raw?.trim()) return;
      const cleaned = toSpeakableLine(raw, 2);
      if (!cleaned) return;
      const gen = ++genRef.current;
      try {
        speechSynthesis.cancel();
      } catch {
        /* noop */
      }
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.src = "";
        } catch {
          /* noop */
        }
        audioRef.current = null;
      }
      const cap = cleaned.length > 220 ? `${cleaned.slice(0, 217)}…` : cleaned;
      void (async () => {
        try {
          const { audioBase64, mimeType } = await window.exec.tts({
            text: cleaned,
            voice: "sage",
          });
          if (genRef.current !== gen) return;
          const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
          audioRef.current = audio;
          audio.onplay = () => {
            if (genRef.current !== gen) return;
            void window.exec.publishVoiceCaption({ assistant: cap });
            void window.exec.workspaceSpeaking(true);
          };
          const finish = () => {
            if (genRef.current !== gen) return;
            void window.exec.publishVoiceCaption({ assistant: null });
            void window.exec.workspaceSpeaking(false);
            if (audioRef.current === audio) audioRef.current = null;
          };
          audio.onended = finish;
          audio.onerror = finish;
          await audio.play();
        } catch {
          if (genRef.current !== gen) return;
          const u = new SpeechSynthesisUtterance(cleaned);
          try {
            speechSynthesis.speak(u);
          } catch {
            void window.exec.workspaceSpeaking(false);
          }
        }
      })();
    },
    [talkBack],
  );

  return speak;
}

/** Small text chat: same Ask + Vmax overlay path as workspace, without opening Command Center. */
export default function OverlayMiniChat({
  talkBack,
  getScreenshot,
  open,
  onOpenChange,
  onPendingChange,
}: {
  talkBack: boolean;
  getScreenshot: () => string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [pending, setPending] = useState(false);
  const repoRef = useRef<RepoContext | undefined>(undefined);
  const msgsRef = useRef<ChatMsg[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const speak = useOverlaySpeak(talkBack);

  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);

  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, msgs, pending]);

  async function send() {
    const q = input.trim();
    if (!q || pending) return;
    setInput("");
    const prior = msgsRef.current;
    const historyForAsk = prior.slice(-6).map(({ role, text }) => ({ role, text }));
    const withUser = [...prior, { role: "user" as const, text: q, ts: Date.now() }];
    msgsRef.current = withUser;
    setMsgs(withUser);
    setPending(true);
    try {
      await ensureRepoContext(repoRef);
      const repo = repoRef.current?.ok ? repoRef.current : undefined;
      const screenshotBase64 = getScreenshot() || null;
      if (typeof window.exec.publishVmaxResponse === "function") {
        void window.exec.publishVmaxResponse({ phase: "loading", question: q });
      }
      if (typeof window.exec.setOverlayExpanded === "function") {
        void window.exec.setOverlayExpanded(true);
      }
      const res = await window.exec.ask({
        question: q,
        screenshotBase64,
        repo,
        history: historyForAsk,
      });
      const { prose } = parseAskActionTag(res.text);
      const assistantText = prose || res.text;
      setMsgs((m) => {
        const next = [...m, { role: "assistant" as const, text: assistantText, ts: Date.now() }];
        msgsRef.current = next;
        return next;
      });
      if (typeof window.exec.publishVmaxResponse === "function") {
        void window.exec.publishVmaxResponse({
          phase: "ready",
          question: q,
          panel: res.structured,
          parseWarning: res.parseWarning,
        });
      }
      speak(deriveSpeakable(res.structured.speakableSummary, res.text));
    } catch (err) {
      const msg = `Ask failed: ${(err as Error).message}`;
      setMsgs((m) => {
        const next = [...m, { role: "assistant" as const, text: msg, ts: Date.now() }];
        msgsRef.current = next;
        return next;
      });
      if (typeof window.exec.publishVmaxResponse === "function") {
        void window.exec.publishVmaxResponse({ phase: "error", message: msg });
      }
    } finally {
      setPending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="no-drag flex flex-col border-t border-white/[0.08] mt-1 pt-2 px-2 pb-2 gap-2 min-h-0">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/45">Chat</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="text-[10px] text-white/45 hover:text-white/80 px-1.5 py-0.5 rounded"
            onClick={() => {
              setMsgs([]);
              msgsRef.current = [];
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="text-[10px] text-white/45 hover:text-white/80 px-1.5 py-0.5 rounded"
            onClick={() => onOpenChange(false)}
          >
            Hide
          </button>
        </div>
      </div>

      <div
        ref={listRef}
        className="flex-1 min-h-[88px] max-h-[160px] overflow-y-auto rounded-xl border border-white/[0.08] bg-black/25 px-2 py-1.5 space-y-2"
      >
        {msgs.length === 0 ? (
          <p className="text-[11px] text-white/40 px-1 py-2">Type a question — same AI as voice, with repo context if you’ve opened a project before.</p>
        ) : (
          msgs.map((m, i) => (
            <div
              key={`${m.ts}-${i}`}
              className={`text-[11px] leading-snug whitespace-pre-wrap break-words rounded-lg px-2 py-1.5 ${
                m.role === "user" ? "bg-white/[0.08] text-white/90 ml-4" : "bg-emerald-500/[0.08] border border-emerald-400/15 text-emerald-50/95 mr-4"
              }`}
            >
              {m.text}
            </div>
          ))
        )}
        {pending ? (
          <div className="text-[10px] text-white/45 animate-pulse px-2">Thinking…</div>
        ) : null}
      </div>

      <div className="flex gap-1.5 shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask anything…"
          rows={2}
          disabled={pending}
          className="flex-1 resize-none rounded-xl border border-white/[0.12] bg-black/35 text-[11px] text-white/90 placeholder:text-white/35 px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={pending || !input.trim()}
          onClick={() => void send()}
          className="shrink-0 self-end h-9 px-3 rounded-xl text-[11px] font-medium bg-emerald-500/85 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:pointer-events-none"
        >
          Send
        </button>
      </div>
    </div>
  );
}
