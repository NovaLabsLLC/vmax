/**
 * Tiny helper for talking directly to the Vmax FastAPI backend from the
 * renderer. The chat / task paths still go through Electron main (which
 * forwards them); workspace CRUD is renderer-direct because it's pure
 * data and CORS already allows our origins.
 *
 * Override the URL by setting `VITE_VMAX_BACKEND_URL` at build time, or
 * `window.__VMAX_BACKEND_URL__` at runtime (handy for one-off tests in
 * DevTools without rebuilding).
 */

declare global {
  interface Window {
    __VMAX_BACKEND_URL__?: string;
  }
}

const FALLBACK_BACKEND_URL = "http://127.0.0.1:8000";

function readEnv(): string | undefined {
  // Vite exposes import.meta.env at compile time; guard for SSR/test envs.
  try {
    // @ts-ignore — import.meta.env is provided by Vite
    return import.meta.env?.VITE_VMAX_BACKEND_URL;
  } catch {
    return undefined;
  }
}

export function backendUrl(path: string): string {
  const raw =
    (typeof window !== "undefined" && window.__VMAX_BACKEND_URL__) ||
    readEnv() ||
    FALLBACK_BACKEND_URL;
  const base = String(raw).replace(/\/+$/, "");
  const tail = path.startsWith("/") ? path : `/${path}`;
  return `${base}${tail}`;
}

/** JSON fetch that surfaces FastAPI's `{ detail }` shape as the thrown error. */
export async function backendFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(backendUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = (j && (j.detail || j.error)) || JSON.stringify(j);
    } catch {
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }

  // 204 No Content (we don't return any, but be defensive).
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}
