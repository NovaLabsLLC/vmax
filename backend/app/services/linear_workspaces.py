"""Backend-owned persistent store for connected Linear workspaces.

Each connected workspace is stored as:

    {
      id, key, label,
      workspace_name, workspace_url_key,
      viewer_name, viewer_email,
      added_at
    }

The JSON file lives under ``backend/data/linear_workspaces.json``. Raw API
keys never leave the backend — the routes layer strips ``key`` before
returning entries to the client and renders ``key_preview`` (last 4 chars)
in its place.

Legacy fallback: if the persistent list is empty but ``LINEAR_API_KEY`` is
set in the env, callers can use ``effective_workspaces()`` which surfaces
the env-based key as a single synthetic entry. The first time a user adds
a workspace through the UI we transition them off the legacy path entirely
(the env key is left in place but the persistent list wins).
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ..config import settings

# All persistent backend data lives under <repo>/backend/data/, gitignored.
_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
_STORE_PATH = _DATA_DIR / "linear_workspaces.json"

# Process-wide lock — protects load → mutate → save sequences. Cheap since
# the surface is tiny (a handful of CRUD calls per session).
_LOCK = threading.Lock()


@dataclass
class LinearWorkspace:
    """In-memory shape. Persisted as-is via ``asdict``."""

    id: str
    key: str
    label: str = ""
    workspace_name: str = ""
    workspace_url_key: str = ""
    viewer_name: str = ""
    viewer_email: str = ""
    added_at: int = field(default_factory=lambda: int(time.time() * 1000))

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "LinearWorkspace":
        return cls(
            id=str(raw.get("id") or ""),
            key=str(raw.get("key") or ""),
            label=str(raw.get("label") or ""),
            workspace_name=str(raw.get("workspace_name") or ""),
            workspace_url_key=str(raw.get("workspace_url_key") or ""),
            viewer_name=str(raw.get("viewer_name") or ""),
            viewer_email=str(raw.get("viewer_email") or ""),
            added_at=int(raw.get("added_at") or 0),
        )


def _ensure_data_dir() -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)


def _read_raw() -> list[LinearWorkspace]:
    if not _STORE_PATH.exists():
        return []
    try:
        with _STORE_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        # Don't crash startup on a corrupt file — log_audit elsewhere will
        # surface the issue when the next write happens.
        return []
    nodes = data.get("workspaces") if isinstance(data, dict) else None
    if not isinstance(nodes, list):
        return []
    out: list[LinearWorkspace] = []
    for raw in nodes:
        if not isinstance(raw, dict):
            continue
        entry = LinearWorkspace.from_dict(raw)
        if entry.id and entry.key:
            out.append(entry)
    return out


def _write_raw(workspaces: list[LinearWorkspace]) -> None:
    _ensure_data_dir()
    tmp = _STORE_PATH.with_suffix(".json.tmp")
    payload = {"workspaces": [asdict(w) for w in workspaces]}
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, sort_keys=False)
    os.replace(tmp, _STORE_PATH)


def _new_id() -> str:
    # Short, URL-safe, prefixed so logs are scannable.
    return f"lw_{secrets.token_hex(6)}"


def list_workspaces() -> list[LinearWorkspace]:
    """Public read — caller decides whether to strip the raw key."""
    with _LOCK:
        return _read_raw()


def effective_workspaces() -> list[LinearWorkspace]:
    """Return stored workspaces, or a synthetic legacy entry built from
    ``LINEAR_API_KEY`` if the persistent list is empty. Used by chat / ask
    routes that want to fan out across "every connected workspace" without
    breaking existing single-key setups."""
    stored = list_workspaces()
    if stored:
        return stored
    if settings.has_linear:
        return [
            LinearWorkspace(
                id="legacy",
                key=settings.linear_api_key,
                label="",
                workspace_name="",
                workspace_url_key="",
                viewer_name="",
                viewer_email="",
                added_at=0,
            )
        ]
    return []


def find(workspace_id: str) -> LinearWorkspace | None:
    target = (workspace_id or "").strip()
    if not target:
        return None
    with _LOCK:
        for w in _read_raw():
            if w.id == target:
                return w
    return None


def upsert(
    *,
    key: str,
    label: str,
    workspace_name: str,
    workspace_url_key: str,
    viewer_name: str,
    viewer_email: str,
) -> LinearWorkspace:
    """Insert or update by ``workspace_url_key`` (preferred) or exact key.
    De-duping prevents accidentally storing the same workspace twice when
    the user pastes an existing key."""
    with _LOCK:
        current = _read_raw()
        match_idx = -1
        for idx, w in enumerate(current):
            if workspace_url_key and w.workspace_url_key == workspace_url_key:
                match_idx = idx
                break
            if not workspace_url_key and w.key == key:
                match_idx = idx
                break
        if match_idx >= 0:
            existing = current[match_idx]
            entry = LinearWorkspace(
                id=existing.id,
                key=key,
                label=label or existing.label,
                workspace_name=workspace_name or existing.workspace_name,
                workspace_url_key=workspace_url_key or existing.workspace_url_key,
                viewer_name=viewer_name or existing.viewer_name,
                viewer_email=viewer_email or existing.viewer_email,
                added_at=existing.added_at or int(time.time() * 1000),
            )
            current[match_idx] = entry
        else:
            entry = LinearWorkspace(
                id=_new_id(),
                key=key,
                label=label,
                workspace_name=workspace_name,
                workspace_url_key=workspace_url_key,
                viewer_name=viewer_name,
                viewer_email=viewer_email,
            )
            current.append(entry)
        _write_raw(current)
        return entry


def remove(workspace_id: str) -> bool:
    target = (workspace_id or "").strip()
    if not target:
        return False
    with _LOCK:
        current = _read_raw()
        kept = [w for w in current if w.id != target]
        if len(kept) == len(current):
            return False
        _write_raw(kept)
        return True


def rename(workspace_id: str, label: str) -> LinearWorkspace | None:
    target = (workspace_id or "").strip()
    if not target:
        return None
    next_label = (label or "").strip()
    with _LOCK:
        current = _read_raw()
        for idx, w in enumerate(current):
            if w.id == target:
                renamed = LinearWorkspace(
                    id=w.id,
                    key=w.key,
                    label=next_label,
                    workspace_name=w.workspace_name,
                    workspace_url_key=w.workspace_url_key,
                    viewer_name=w.viewer_name,
                    viewer_email=w.viewer_email,
                    added_at=w.added_at,
                )
                current[idx] = renamed
                _write_raw(current)
                return renamed
    return None


def to_public(entry: LinearWorkspace) -> dict[str, Any]:
    """Strip the raw key for client-bound responses. ``key_preview`` shows
    the last 4 chars so the user can confirm "this is the key I pasted"
    without us ever leaking the secret."""
    return {
        "id": entry.id,
        "label": entry.label,
        "workspace_name": entry.workspace_name,
        "workspace_url_key": entry.workspace_url_key,
        "viewer_name": entry.viewer_name,
        "viewer_email": entry.viewer_email,
        "added_at": entry.added_at,
        "key_preview": f"…{entry.key[-4:]}" if entry.key else "",
    }
