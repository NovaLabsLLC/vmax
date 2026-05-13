import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Row = {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  repoName: string | null;
  repoPath: string | null;
};

type Props = {
  activeSessionId: string | null;
  onActiveSessionChange: (id: string | null) => void;
};

type WorkspaceGroup = {
  key: string;
  label: string;
  repoPath: string | null;
  repoName: string | null;
  sessions: Row[];
};

function pathKey(repoPath: string | null | undefined): string {
  const p = `${repoPath ?? ""}`.trim();
  return p || "__scratch__";
}

function repoBasename(full: string): string {
  const s = full.replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return (i >= 0 ? s.slice(i + 1) : s) || "Repo";
}

function groupSessions(rows: Row[]): WorkspaceGroup[] {
  const map = new Map<string, WorkspaceGroup>();
  for (const r of rows) {
    const key = pathKey(r.repoPath);
    const had = map.get(key);
    if (!had) {
      map.set(key, {
        key,
        label: "",
        repoPath: key === "__scratch__" ? null : r.repoPath,
        repoName: r.repoName,
        sessions: [r],
      });
    } else {
      had.sessions.push(r);
      if (!had.repoName && r.repoName) had.repoName = r.repoName;
      if (!had.repoPath && r.repoPath) had.repoPath = r.repoPath;
    }
  }
  for (const g of map.values()) {
    g.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (g.key === "__scratch__") {
      g.label = "Scratch";
      g.repoPath = null;
      g.repoName = null;
    } else {
      const pathStr = g.repoPath || "";
      g.label = (g.repoName || "").trim() || repoBasename(pathStr);
    }
  }
  const list = Array.from(map.values());
  list.sort((a, b) => {
    if (a.key === "__scratch__") return -1;
    if (b.key === "__scratch__") return 1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
  return list;
}

const AVATARS_LS_KEY = "workspace-rail-avatars-v1";
const AVATAR_MAX_READ = 2_500_000;
const AVATAR_OUT_PX = 112;

function avatarPalette(seed: string): { h: number; s: number; l: number } {
  let a = 2166136261;
  let b = 374761393;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = (b * 33 + c * 17) >>> 0;
  }
  const h = (a >>> 0) % 360;
  const s = 44 + (b % 22);
  const l = 32 + ((b >>> 10) % 14);
  return { h, s, l };
}

function readStoredAvatars(): Record<string, string> {
  try {
    const raw = localStorage.getItem(AVATARS_LS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "string" && v.startsWith("data:image/")) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStoredAvatars(map: Record<string, string>) {
  try {
    localStorage.setItem(AVATARS_LS_KEY, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > AVATAR_MAX_READ) {
      reject(new Error("Image is too large — try under ~2 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.onload = () => {
      const url = reader.result;
      if (typeof url !== "string") {
        reject(new Error("Could not read file."));
        return;
      }
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          reject(new Error("Invalid image."));
          return;
        }
        const scale = Math.min(1, AVATAR_OUT_PX / w, AVATAR_OUT_PX / h);
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not draw image."));
          return;
        }
        ctx.drawImage(img, 0, 0, cw, ch);
        try {
          resolve(canvas.toDataURL("image/jpeg", 0.88));
        } catch {
          reject(new Error("Could not encode image."));
        }
      };
      img.onerror = () => reject(new Error("Invalid image."));
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Narrow Discord-style workspace rail — icons only. Click selects most recent chat
 * in that repo bucket (+ session change).
 */
export default function WorkspaceIconRail({ activeSessionId, onActiveSessionChange }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [addingWs, setAddingWs] = useState(false);
  const [selectedWsKey, setSelectedWsKey] = useState("__scratch__");
  const [avatars, setAvatars] = useState<Record<string, string>>(readStoredAvatars);
  const [iconMenu, setIconMenu] = useState<{ x: number; y: number; wsKey: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarPickTargetRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await window.exec.listSessions());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = window.exec.onSessionsUpdated(() => void refresh());
    return () => off();
  }, [refresh]);

  const workspaces = useMemo(() => groupSessions(rows), [rows]);

  const menuPos = useMemo(() => {
    if (!iconMenu) return null;
    const pad = 8;
    const mw = 172;
    const mh = 92;
    const left = Math.min(Math.max(pad, iconMenu.x), window.innerWidth - mw - pad);
    const top = Math.min(Math.max(pad, iconMenu.y), window.innerHeight - mh - pad);
    return { left, top };
  }, [iconMenu]);

  useEffect(() => {
    if (!iconMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIconMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [iconMenu]);

  useEffect(() => {
    if (workspaces.length === 0) return;
    const valid = new Set(workspaces.map((w) => w.key));
    setAvatars((prev) => {
      const keys = Object.keys(prev);
      if (!keys.some((k) => !valid.has(k))) return prev;
      const next: Record<string, string> = {};
      for (const k of keys) if (valid.has(k)) next[k] = prev[k]!;
      writeStoredAvatars(next);
      return next;
    });
  }, [workspaces]);

  useEffect(() => {
    if (!activeSessionId || rows.length === 0) return;
    const hit = rows.find((r) => r.id === activeSessionId);
    if (hit) setSelectedWsKey(pathKey(hit.repoPath));
  }, [activeSessionId, rows]);

  useEffect(() => {
    if (workspaces.length === 0) {
      setSelectedWsKey("__scratch__");
      return;
    }
    const exists = workspaces.some((w) => w.key === selectedWsKey);
    if (!exists) {
      const firstWithActive =
        activeSessionId && workspaces.find((w) => w.sessions.some((s) => s.id === activeSessionId));
      setSelectedWsKey((firstWithActive ?? workspaces[0]).key);
    }
  }, [workspaces, selectedWsKey, activeSessionId]);

  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    const key = avatarPickTargetRef.current;
    avatarPickTargetRef.current = null;
    if (!file || !key) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatars((prev) => {
        const next = { ...prev, [key]: dataUrl };
        writeStoredAvatars(next);
        return next;
      });
    } catch (err) {
      window.alert(String((err as Error)?.message || err));
    }
  }

  function selectWorkspace(ws: WorkspaceGroup) {
    setSelectedWsKey(ws.key);
    const first = ws.sessions[0]?.id ?? null;
    if (first) onActiveSessionChange(first);
  }

  async function addWorkspaceFromFolder() {
    setAddingWs(true);
    try {
      const picked = await window.exec.pickRepo();
      if (!picked) return;
      const name = repoBasename(picked);
      const s = await window.exec.newSession({ repoPath: picked, repoName: name });
      await refresh();
      setSelectedWsKey(pathKey(picked));
      const id = s?.id as string | undefined;
      if (id) onActiveSessionChange(id);
    } finally {
      setAddingWs(false);
    }
  }

  return (
    <>
      <div className="h-full min-h-0 w-[78px] shrink-0 flex flex-col border-r border-white/[0.1] bg-[#08080a]/95 backdrop-blur-sm">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => void handleAvatarFile(e)}
        />
        <nav
          className="flex-1 flex flex-col items-center gap-4 py-4 overflow-y-auto overflow-x-visible min-h-0"
          aria-label="Workspaces"
        >
        {workspaces.map((ws) => {
          const active = ws.key === selectedWsKey;
          const palette = avatarPalette(ws.key);
          const customImg = avatars[ws.key];
          return (
            <button
              key={ws.key}
              type="button"
              title={`${ws.label} — switch workspace · right-click icon`}
              onClick={() => selectWorkspace(ws)}
              onContextMenu={(e) => {
                e.preventDefault();
                setIconMenu({ x: e.clientX, y: e.clientY, wsKey: ws.key });
              }}
              className={`relative group shrink-0 size-12 overflow-hidden rounded-[16px] flex items-center justify-center transition-all duration-150 ease-out
                ${active ? "rounded-[14px] ring-2 ring-white/95 shadow-[0_0_0_1px_rgba(255,255,255,0.22)] scale-[1.02]" : "rounded-[16px] border hover:rounded-[14px] hover:brightness-[1.08]"}`}
              style={
                customImg || active
                  ? undefined
                  : {
                      borderColor: `hsla(${palette.h}, ${Math.min(62, palette.s + 8)}%, 52%, 0.45)`,
                    }
              }
            >
              <WorkspaceFace wsKey={ws.key} label={ws.label} img={customImg} railActive={active} />
              {active ? (
                <span
                  className="absolute left-[-3px] top-1/2 -translate-y-1/2 w-[3px] h-9 rounded-r bg-white shadow-[2px_0_12px_rgba(255,255,255,0.45)] pointer-events-none"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
        <div className="flex-1 min-h-2" />
        <button
          type="button"
          title="Add workspace — pick a repo folder"
          disabled={addingWs}
          onClick={() => void addWorkspaceFromFolder()}
          className="shrink-0 size-12 rounded-[16px] border border-dashed border-white/20 text-white/55 hover:text-white hover:border-white/35 hover:bg-white/[0.06]
                     flex items-center justify-center text-xl leading-none disabled:opacity-40"
        >
          {addingWs ? "…" : "+"}
        </button>
      </nav>
      </div>

      {iconMenu && menuPos && typeof document !== "undefined"
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-[1999] bg-transparent"
                aria-hidden
                onPointerDown={() => setIconMenu(null)}
              />
              <div
                role="menu"
                aria-label="Workspace icon"
                className="fixed z-[2000] min-w-[172px] rounded-lg border border-white/[0.14] bg-[#121218]/98 backdrop-blur-md py-1 shadow-[0_16px_48px_-8px_rgba(0,0,0,0.88)]"
                style={{ left: menuPos.left, top: menuPos.top }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left text-[11px] px-2.5 py-1.5 text-white/88 hover:bg-white/[0.08] transition-colors"
                  onClick={() => {
                    const k = iconMenu.wsKey;
                    setIconMenu(null);
                    avatarPickTargetRef.current = k;
                    queueMicrotask(() => fileInputRef.current?.click());
                  }}
                >
                  Set picture…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!avatars[iconMenu.wsKey]}
                  className="w-full text-left text-[11px] px-2.5 py-1.5 text-white/88 hover:bg-white/[0.08] transition-colors disabled:opacity-35 disabled:pointer-events-none"
                  onClick={() => {
                    const k = iconMenu.wsKey;
                    setIconMenu(null);
                    setAvatars((prev) => {
                      if (!prev[k]) return prev;
                      const next = { ...prev };
                      delete next[k];
                      writeStoredAvatars(next);
                      return next;
                    });
                  }}
                >
                  Remove picture
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

function WorkspaceFace({
  wsKey,
  label,
  img,
  railActive,
}: {
  wsKey: string;
  label: string;
  img?: string;
  railActive: boolean;
}) {
  const palette = avatarPalette(wsKey);
  const letter = (label || "?").slice(0, 1).toUpperCase();
  if (img) {
    return (
      <img
        src={img}
        alt=""
        className="size-full object-cover pointer-events-none select-none"
        draggable={false}
      />
    );
  }
  if (railActive) {
    return (
      <span className="flex size-full items-center justify-center text-[15px] font-semibold tracking-tight text-neutral-950 bg-white pointer-events-none select-none">
        {letter}
      </span>
    );
  }
  return (
    <span
      className="flex size-full items-center justify-center text-[15px] font-semibold tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)] pointer-events-none select-none"
      style={{ backgroundColor: `hsl(${palette.h} ${palette.s}% ${palette.l}%)` }}
    >
      {letter}
    </span>
  );
}
