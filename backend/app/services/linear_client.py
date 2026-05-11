"""Async GraphQL client for Linear (https://linear.app).

The `/v1/ask` route short-circuits questions that reference a Linear issue
identifier (e.g. ``EXE-35``) to this client instead of relying on the
screenshot context, and can apply ``issueUpdate`` when the user clearly
asks to change state, title, description, or priority. The Linear
personal-API-key auth header is bare ``Authorization: <key>`` — not
``Bearer <key>`` — per Linear's docs.

If ``LINEAR_API_KEY`` is unset, callers should detect that via
``settings.has_linear`` and skip Linear entirely; this module raises
``LinearClientError`` rather than swallowing missing-config silently.
"""

from __future__ import annotations

import re
from typing import Any

import httpx

from ..config import settings
from . import linear_workspaces

LINEAR_API_URL = "https://api.linear.app/graphql"
REQUEST_TIMEOUT_S = 20.0

# Matches Linear short-IDs: 2-10 uppercase team-key letters, a dash, then
# digits. We uppercase the input before searching so the user can type
# "exe-35" or "EXE-35" or even "Exe-35".
_ISSUE_ID_RE = re.compile(r"\b[A-Z]{2,10}-\d+\b")

# Phrases that almost always mean "show me the issues assigned to me".
# Kept conservative — every entry should be specific enough that a false
# positive would be surprising. "my" alone is too broad (e.g. "fix my
# bug") so the bare-"my-X" entries all require a work-noun.
_MY_ISSUES_PHRASES: tuple[str, ...] = (
    "my tickets",
    "my ticket queue",
    "my issues",
    "my open issues",
    "my assigned",
    "my assignments",
    "my plate",
    "my queue",
    "linear task",
    "linear tasks",
    "linear ticket",
    "linear tickets",
    "linear issue",
    "linear issues",
    "linear backlog",
    "what should i work on",
    "what should i do next",
    "what should i tackle",
    "what should i focus on",
    "what am i working on",
    "what's on my plate",
    "whats on my plate",
    "what's next for me",
    "whats next for me",
    "on my plate",
)

# When the user says one of these we still need a noun to confirm it's
# about Linear work, not e.g. "show me my code".
_MY_ISSUES_VERB_PREFIXES: tuple[str, ...] = (
    "show me my",
    "list my",
    "what are my",
    "what's in my",
    "whats in my",
)

_WORK_NOUNS: tuple[str, ...] = (
    "ticket",
    "tickets",
    "issue",
    "issues",
    "task",
    "tasks",
    "todo",
    "todos",
    "linear",
    "work",
    "queue",
    "assignment",
    "assignments",
    "backlog",
    "board",
    "stuff",
    "things",
)

# Loose STT-ish matches (Whisper typo clusters around "tasks")
_LOOSE_TASK_CHUNK = re.compile(r"\bt+a+s*k+\w*", re.I)


def _looks_like_linear_backlog_question(t: str) -> bool:
    """Voice / slang: wants assigned Linear workload, not arbitrary Q&A."""

    low = t.lower()

    workload_token = (
        any(noun in low for noun in ("task", "tasks", "tix"))
        or bool(_LOOSE_TASK_CHUNK.search(low))
        or any(pk in low for pk in ("issues", "ticket", "tickets"))
        or any(pk in low for pk in ("assignment", "assignments"))
        or any(pk in low for pk in ("backlog", "board", "sprint"))
    )

    if "linear" in low and workload_token:
        return True

    return False


def is_my_issues_question(text: str | None) -> bool:
    """Heuristic: does this question mean "fetch my assigned Linear issues"?

    Designed for high precision (never trigger on unrelated "my ..."
    phrases) at the cost of some recall — extend ``_MY_ISSUES_PHRASES``
    as new phrasings show up in real usage."""
    if not text:
        return False
    t = text.lower().strip()

    for phrase in _MY_ISSUES_PHRASES:
        if phrase in t:
            return True

    for verb in _MY_ISSUES_VERB_PREFIXES:
        if verb in t and any(noun in t for noun in _WORK_NOUNS):
            return True

    if _looks_like_linear_backlog_question(t):
        return True

    return False


class LinearClientError(Exception):
    """Anything that goes wrong talking to Linear — network, auth, or a
    GraphQL ``errors`` payload coming back. The route handler decides
    whether to surface this to the user or fall through to the LLM."""


def extract_linear_issue_id(text: str | None) -> str | None:
    if not text:
        return None
    match = _ISSUE_ID_RE.search(text.upper())
    return match.group(0) if match else None


# Map casual words to Linear ``WorkflowState.type`` values returned by GraphQL.
_STATE_KEYWORD_TO_TYPE: dict[str, str] = {
    # completed
    "done": "completed",
    "doing": "started",
    "fix": "completed",
    "fixed": "completed",
    "completed": "completed",
    "complete": "completed",
    "closes": "completed",
    "close": "completed",
    "closing": "completed",
    "closed": "completed",
    "finish": "completed",
    "finishes": "completed",
    "finished": "completed",
    "finalize": "completed",
    "ship": "completed",
    "shipped": "completed",
    "merged": "completed",
    "merge": "completed",
    "deployed": "completed",
    "deploy": "completed",
    "resolve": "completed",
    "resolves": "completed",
    "resolved": "completed",
    # canceled (Linear spelling is ``canceled``)
    "cancel": "canceled",
    "canceling": "canceled",
    "cancelling": "canceled",
    "cancelled": "canceled",
    "canceled": "canceled",
    "duplicate": "canceled",
    "wontfix": "canceled",
    "won't fix": "canceled",
    "wont": "canceled",
    # backlog / unstarted
    "todo": "unstarted",
    "backlog": "backlog",
    "unstarted": "unstarted",
    "planned": "unstarted",
    "queue": "unstarted",
    "queued": "unstarted",
    "triage": "unstarted",
    # started — best-effort synonyms (boards often use custom columns)
    "progress": "started",
    "in progress": "started",
    "in-progress": "started",
    "active": "started",
    "started": "started",
    "implementing": "started",
    "working": "started",
    "blocked": "started",
    "review": "started",
}


_READ_OVER_UPDATE_HINTS_RE = re.compile(
    r"(?ix)^\s*("
    r"what'?s\b|what is\b|what are\b"
    r"|who\b|when\b|where\b|why\b|how does\b|how do\b|how should\b"
    r"|tell me\b|explain\b|describe\b|summarize\b|summarise\b"
    r"|give me\b|give us\b"
    r"|lookup\b|fetch\b"
    r"|can you explain\b)"
)


def prefers_linear_issue_read_over_update(question: str | None) -> bool:
    """Interrogative summaries should win over destructive Linear updates."""

    q = question or ""
    if not q.strip():
        return True
    if _READ_OVER_UPDATE_HINTS_RE.match(q.strip()):
        return True
    if "how do i " in q.lower() or "how should i " in q.lower():
        return True
    return False


def extract_linear_issue_update_fields(
    question: str,
    issue_identifier: str,
) -> dict[str, Any] | None:
    """Parse imperative Linear updates (workflow state, priority, title …).

    Returns ``None`` when nothing actionable parses."""

    prio_vocab: dict[str, int] = {
        "none": 0,
        "nopriority": 0,
        "nop": 0,
        "np": 0,
        "urgent": 1,
        "p1": 1,
        "high": 2,
        "p2": 2,
        "medium": 3,
        "med": 3,
        "mid": 3,
        "normal": 3,
        "p3": 3,
        "low": 4,
        "p4": 4,
        "p0": 0,
        "p5": 4,
        "0": 0,
        "1": 1,
        "2": 2,
        "3": 3,
        "4": 4,
        "5": 0,
        "6": 0,
        "7": 0,
        "8": 0,
        "9": 0,
    }

    iq = issue_identifier.upper()
    iid_esc = re.escape(iq)
    q = question.strip()
    patches: dict[str, Any] = {}

    rename_m = re.search(
        rf"(?is)\brename\b\s+[^\n]{{0,160}}?\b{iid_esc}\b\s+\bto\b\s*(?P<t>[^\n]+)",
        q,
    )
    if not rename_m:
        rename_m = re.search(
            rf"(?is)\b{iid_esc}\b\s+(?:ticket|issue\s+)?\brename\b\s+\bto\b\s*(?P<t>[^\n]+)",
            q,
        )
    append_m = re.search(
        rf"(?is)\b{iid_esc}\b[^\n]{{0,160}}?\b(?:add|append)\b[^\n]{{0,80}}?"
        rf"\b(?:desc(?:ription)?)\b[^\n]{{0,70}}?[:\.](?P<a>[^\n]+)",
        q,
    )
    if append_m:
        text = append_m.group("a").strip().strip(".").strip()
        if text:
            patches.setdefault("description_append", text)

    if not patches.get("description_append"):
        append_m = re.search(
            rf"(?is)\b(?:add|append)\b[^\n]{{0,120}}?\b(?:desc(?:ription)?)"
            rf"\b[^\n]{{0,90}}?\b{iid_esc}\b[^\n]{{0,70}}?[:\.](?P<a>[^\n]+)",
            q,
        )
        if append_m:
            patches.setdefault(
                "description_append",
                append_m.group("a").strip().strip(".").strip(),
            )

    if not patches.get("description_append"):
        append_m = re.search(
            rf"(?is)\b(?:add|append)\b[^\n]{{0,60}}?\b(?:this\b\s+)?"
            rf"(?:(?:something|text)\s+)?\bto\b\s*\b(?:the\s+)?(?:desc(?:ription)?)"
            rf"\b[^\n]{{0,40}}?\b(?:at\b\s*\b(?:the\s+)?end\b)?[^\n]{{0,40}}"
            rf"\b{iid_esc}\b[^\n]{{0,40}}?[:\.](?P<a>[^\n]+)",
            q,
        )
        if append_m:
            patches.setdefault(
                "description_append",
                append_m.group("a").strip().strip(".").strip(),
            )

    if not patches.get("description_append"):
        append_m = re.search(
            rf"(?is)\b(?:add|append)\b[^\n]{{0,60}}?\b(?:this\b\s+)?"
            rf"(?:(?:something|text)\s+)?\bto\b\s*\b(?:the\s+)?(?:desc(?:ription)?)"
            rf"\b[^\n]{{0,40}}?\b(?:at\b\s*\b(?:the\s+)?end\b)[^\n]{{0,40}}"
            rf"\b{iid_esc}\b[^\n]{{0,35}}?[:\.](?P<a>[^\n]+)",
            q,
        )
        if append_m:
            patches.setdefault(
                "description_append",
                append_m.group("a").strip().strip(".").strip(),
            )

    if rename_m:
        t_raw = rename_m.group("t").strip().strip('"').strip("'").strip()
        if t_raw and iq.lower() not in t_raw.lower():
            patches["title"] = t_raw

    prio_m = re.search(
        rf"(?is)\bpriority\b[^\n.]{{0,130}}?\b{iid_esc}\b[^\n.]{{0,70}}?"
        rf"\bto\b\s*(?P<p>\S[^\n.]{{0,28}}?)",
        q,
    )
    if not prio_m:
        prio_m = re.search(
            rf"(?is)\b{iid_esc}\b[^\n.]{{0,95}}\bpriority\b[^\n.]{{0,52}}?"
            rf"\bto\b\s*(?P<p>\S[^\n.]{{0,28}}?)",
            q,
        )
    prio_raw_clean: str | None = None
    if prio_m:
        prio_raw_clean = prio_m.group("p").strip().strip('"').strip("'").strip(".")
        pkey_spaced = prio_raw_clean.lower().replace("-", " ")
        pk = pkey_spaced.replace(" ", "")
        prio_val = prio_vocab.get(pk) or prio_vocab.get(prio_raw_clean.lower())
        if prio_val is None and prio_raw_clean.isdigit():
            n = int(prio_raw_clean)
            if 0 <= n <= 4:
                prio_val = n
        if prio_val is not None:
            patches["priority"] = prio_val

    desc_m = re.search(
        rf"(?is)\b(?:description|desc)\b[^\n.]{{0,50}}?\b{iid_esc}\b[^\n.]{{0,50}}?"
        rf"\bto\b\s+[""'](?P<d>[^""']+)[""']",
        q,
    )
    if desc_m:
        patches["description"] = desc_m.group("d").strip()
    if not patches.get("description"):
        desc_plain = re.search(
            rf"(?is)\b(?:desc(?:ription)?)\b[^\n.]{{0,55}}?\b{iid_esc}\b[^\n.]{{0,55}}?"
            rf"\bto\b\s*(?P<d>[^\n]+)",
            q,
        )
        if desc_plain:
            patches["description"] = desc_plain.group("d").strip()

    rename_sentence = bool(rename_m) or bool(
        re.search(rf"(?is)\brename\b[^\n]{{0,200}}?\b{iid_esc}\b", q)
    )

    move_m = re.search(
        rf"(?is)\bmove\b[^\n.;]{{0,100}}?\b{iid_esc}\b[^\n.;]{{0,50}}"
        rf"\bto\b\s*(?P<lbl>[^\n.;?]+)",
        q,
    )
    if move_m:
        patches["state_target"] = move_m.group("lbl").strip().strip('"').strip("'").strip(".")

    asm = re.search(
        rf"(?is)\b(?:mark|set)\b[^\n.;]{{0,100}}?\b{iid_esc}\b[^\n.;]{{0,50}}"
        rf"\bas\b\s*(?P<lbl>[^\n.;?]+)",
        q,
    )
    if asm:
        patches["state_target"] = asm.group("lbl").strip().strip('"').strip("'").strip(".")

    sts_m = re.search(
        rf"(?is)\b(?:status|state)\b[^\n.;]{{0,90}}?\b{iid_esc}\b[^\n.;]{{0,55}}"
        rf"\bto\b\s*(?P<lbl>[^\n.;?]+)",
        q,
    )
    if sts_m:
        patches["state_target"] = sts_m.group("lbl").strip().strip('"').strip("'").strip(".")

    trailing = re.search(
        rf"(?is)\b{iid_esc}\b[^\n.;]{{0,40}}\bto\b\s*(?P<lbl>[^\n.;?]+)",
        q,
    )
    if trailing and not rename_sentence and move_m is None and asm is None and sts_m is None:
        lbl = trailing.group("lbl").strip().strip('"').strip("'").strip(".")
        first_w = lbl.lower().split()[0] if lbl.split() else ""
        ok_first = bool(first_w) and first_w not in {"priority", "rename", "the"}
        if ok_first and "priority to" not in q.lower()[trailing.start() : trailing.end()]:
            lk = lbl.lower().replace("-", "").replace(" ", "")
            if lk in prio_vocab and prio_raw_clean != lbl.strip():
                patches.setdefault("priority", prio_vocab[lk])
            elif lk not in prio_vocab:
                patches.setdefault("state_target", lbl)

    if not (rename_m and patches.get("title")):
        if re.search(
            rf"(?is)\b(?:close|closes|finish|finishes|complete|completed|finalize|"
            rf"ship|shipped|deploy|deployed|resolve|resolves|resolved)\w*\s+"
            rf".{{0,24}}\b{iid_esc}\b",
            q,
        ):
            patches.setdefault("state_target", "completed")
        if re.search(
            rf"(?is)\b(?:re[- ]?)?open\b\s+.{0,24}\b{iid_esc}\b",
            q,
        ):
            patches.setdefault("state_target", "started")
        if re.search(
            rf"(?is)\b(?:cancel|cancelling|cancelled|canceled)\w*\s+.{0,24}\b{iid_esc}\b",
            q,
        ):
            patches.setdefault("state_target", "canceled")

    if rename_m and patches.get("title"):
        if move_m is None and asm is None and sts_m is None:
            patches.pop("state_target", None)
    st = patches.get("state_target")
    if isinstance(st, str) and patches.get("priority") is None:
        st0 = st.strip().lower().split()[0] if st.strip() else ""
        st_compact = st.lower().replace(" ", "").replace("-", "")
        if st_compact in prio_vocab or st0 in prio_vocab:
            v = prio_vocab.get(st_compact) or prio_vocab.get(st0)
            if v is not None:
                patches.pop("state_target", None)
                patches["priority"] = v

    return patches if patches else None


async def linear_graphql(
    query: str,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not settings.has_linear:
        raise LinearClientError("LINEAR_API_KEY missing on the server")

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
            response = await client.post(
                LINEAR_API_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": settings.linear_api_key,
                },
                json={"query": query, "variables": variables or {}},
            )
    except httpx.HTTPError as err:
        raise LinearClientError(f"Linear network error: {err}") from err

    if response.status_code >= 400:
        # Keep the body short — Linear's 4xx errors are usually small and
        # safe to surface, but truncate defensively just in case.
        body = response.text[:1000]
        raise LinearClientError(
            f"Linear HTTP {response.status_code}: {body}"
        )

    try:
        payload = response.json()
    except ValueError as err:
        raise LinearClientError(f"Linear response was not JSON: {err}") from err

    if payload.get("errors"):
        raise LinearClientError(f"Linear GraphQL errors: {payload['errors']}")

    return payload.get("data") or {}


_ISSUE_FIELDS = """
  id
  identifier
  title
  description
  url
  priority
  estimate
  branchName
  createdAt
  updatedAt
  dueDate
  state { id name type }
  team { id key name }
  assignee { id name displayName email }
  creator { id name email }
  project { id name state }
  cycle { id name startsAt endsAt }
  labels { nodes { id name } }
  comments(first: 15) {
    nodes { id body createdAt user { name email } }
  }
"""


_GET_ISSUE_QUERY = (
    "query Issue($id: String!) { issue(id: $id) {" + _ISSUE_FIELDS + "} }"
)

_MY_ISSUES_QUERY = (
    "query MyIssues($first: Int!) { viewer { assignedIssues(first: $first) {"
    " nodes {" + _ISSUE_FIELDS + "} } } }"
)

_TEAM_WORKFLOW_STATES_QUERY = """
query TeamWorkflowStates($teamId: String!) {
  team(id: $teamId) {
    states {
      nodes { id name type position }
    }
  }
}
"""

_ISSUE_UPDATE_RESULT_FIELDS = """
  id
  identifier
  title
  url
  priority
  state { id name type }
"""

_ISSUE_UPDATE_MUTATION = (
    "mutation IssueUpdateLinear($issueId: String!, $input: IssueUpdateInput!) {"
    " issueUpdate(id: $issueId, input: $input) { success"
    " issue {" + _ISSUE_UPDATE_RESULT_FIELDS + "}"
    " }"
    "}"
)


# ---------------------------------------------------------------------------
# Explicit-key helpers + workspace fan-out (`linear_workspaces` store /
# synthetic legacy env token).
# ---------------------------------------------------------------------------


_VERIFY_VIEWER_QUERY = """
  query VerifyLinearViewer {
    viewer {
      id name displayName email
      organization { id name urlKey }
    }
  }
"""


async def linear_graphql_with_key(
    api_key: str,
    query: str,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Same as ``linear_graphql`` but takes the API key explicitly so we
    can target any saved workspace, not just the env-configured one."""
    key = (api_key or "").strip()
    if not key:
        raise LinearClientError("Linear API key is empty")

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
            response = await client.post(
                LINEAR_API_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": key,
                },
                json={"query": query, "variables": variables or {}},
            )
    except httpx.HTTPError as err:
        raise LinearClientError(f"Linear network error: {err}") from err

    if response.status_code >= 400:
        body = response.text[:1000]
        raise LinearClientError(
            f"Linear HTTP {response.status_code}: {body}"
        )

    try:
        payload = response.json()
    except ValueError as err:
        raise LinearClientError(f"Linear response was not JSON: {err}") from err

    if payload.get("errors"):
        raise LinearClientError(f"Linear GraphQL errors: {payload['errors']}")

    return payload.get("data") or {}


async def verify_linear_key(api_key: str) -> dict[str, str]:
    """Validate a key with Linear and surface viewer + workspace info.

    Returns ``{viewer_name, viewer_email, workspace_name, workspace_url_key}``
    on success. Raises ``LinearClientError`` if the key is empty/invalid or
    Linear refuses it."""
    data = await linear_graphql_with_key(api_key, _VERIFY_VIEWER_QUERY)
    viewer = data.get("viewer") or {}
    org = viewer.get("organization") or {}
    return {
        "viewer_name": viewer.get("name") or viewer.get("displayName") or "",
        "viewer_email": viewer.get("email") or "",
        "workspace_name": org.get("name") or "",
        "workspace_url_key": org.get("urlKey") or "",
    }


async def get_my_open_issues_with_key(
    api_key: str,
    limit: int = 25,
) -> list[dict[str, Any]]:
    """Open assigned issues for the viewer of a specific key."""
    data = await linear_graphql_with_key(api_key, _MY_ISSUES_QUERY, {"first": limit})
    viewer = data.get("viewer") or {}
    assigned = (viewer.get("assignedIssues") or {}).get("nodes") or []
    return [
        issue
        for issue in assigned
        if (issue.get("state") or {}).get("type") not in ("completed", "canceled")
    ]


async def aggregate_open_assigned_issues(
    limit_per_workspace: int = 25,
) -> list[dict[str, Any]]:
    """All open assigned issues across every persisted/synthetic workspace,
    merged and globally priority-sorted. Each row carries ``_workspace_name``
    so the formatter can annotate multi-org setups."""

    workspaces = linear_workspaces.effective_workspaces()
    if not workspaces:
        return []

    merged: list[dict[str, Any]] = []

    for ws in workspaces:
        api_key = (ws.key or "").strip()
        if not api_key:
            continue
        ws_label = (ws.label or ws.workspace_name or "").strip()

        try:
            chunk = await get_my_open_issues_with_key(api_key, limit_per_workspace)
        except LinearClientError:
            continue
        tag = ws_label if ws_label else "Linear"
        for issue in chunk:
            merged.append({**issue, "_workspace_name": tag})

    return sort_my_issues(merged)


async def get_linear_issue(issue_id: str) -> dict[str, Any] | None:
    """Try each configured workspace token until Linear returns ``issue``.
    Mirrors how the Settings UI persists keys independently of ``.env``."""
    for ws in linear_workspaces.effective_workspaces():
        api_key = (ws.key or "").strip()
        if not api_key:
            continue
        try:
            data = await linear_graphql_with_key(
                api_key, _GET_ISSUE_QUERY, {"id": issue_id},
            )
        except LinearClientError:
            continue
        hit = data.get("issue")
        if hit:
            return hit
    return None


async def get_linear_issue_with_api_key(
    issue_id: str,
) -> tuple[dict[str, Any], str] | None:
    """Like ``get_linear_issue`` but also returns which API key resolved it,
    needed for issuing mutations scoped to that workspace."""

    for ws in linear_workspaces.effective_workspaces():
        api_key = (ws.key or "").strip()
        if not api_key:
            continue
        try:
            data = await linear_graphql_with_key(
                api_key, _GET_ISSUE_QUERY, {"id": issue_id},
            )
        except LinearClientError:
            continue
        hit = data.get("issue")
        if hit:
            return hit, api_key
    return None


async def fetch_team_workflow_states(api_key: str, team_id: str) -> list[dict[str, Any]]:
    data = await linear_graphql_with_key(
        api_key,
        _TEAM_WORKFLOW_STATES_QUERY,
        {"teamId": team_id},
    )
    team = data.get("team") or {}
    return list((team.get("states") or {}).get("nodes") or [])


def _workflow_states_sorted_by_column(states: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def position(s: dict[str, Any]) -> float:
        p = s.get("position")
        try:
            return float(p)
        except (TypeError, ValueError):
            return 0.0

    return sorted(states, key=position)


def workflow_state_id_for_linear_type(states: list[dict[str, Any]], linear_type: str) -> str | None:
    """Pick the earliest workflow column that matches Linear's ``type``.

    Typical boards have exactly one ``completed`` column, etc."""
    lt = linear_type.strip().lower()
    pool = [s for s in states if ((s.get("type") or "").strip().lower() == lt)]
    if not pool:
        return None
    ordered = _workflow_states_sorted_by_column(pool)
    return ordered[0].get("id")


def workflow_state_id_for_label(states: list[dict[str, Any]], fragment: str) -> str | None:
    """Exact or ``needle in column_name`` match (never reverse — avoids
    e.g. matching *Finished* against *unfinished*)."""

    needle = fragment.strip().lower()
    if not needle:
        return None
    normalized: list[tuple[int, dict[str, Any]]] = []
    for s in states:
        nm = ((s.get("name") or "").strip().lower())
        if not nm:
            continue
        if nm == needle:
            return s.get("id")
        if needle in nm:
            normalized.append((len(nm), s))
    if not normalized:
        return None
    normalized.sort(key=lambda kv: kv[0])
    return normalized[0][1].get("id")


def _linear_state_type_from_phrase(phrase_lo: str) -> str | None:
    synonyms = sorted(
        _STATE_KEYWORD_TO_TYPE.items(),
        key=lambda kv: len(kv[0]),
        reverse=True,
    )
    for word, wf in synonyms:
        if " " in word or "'" in word:
            if word in phrase_lo:
                return wf
        elif re.search(rf"(?<!\w){re.escape(word)}(?!\w)", phrase_lo):
            return wf
    return None


def workflow_state_id_for_target(states: list[dict[str, Any]], target: str) -> str | None:
    """Prefer a named board column, then fall back to Linear ``type``.

    Resolves inputs like *In Review* (label) or *done* (maps to
    ``completed``)."""
    trimmed = target.strip().lower()
    if not trimmed:
        return None
    sid = workflow_state_id_for_label(states, target)
    if sid:
        return sid
    wf_type = _linear_state_type_from_phrase(trimmed)
    if wf_type:
        return workflow_state_id_for_linear_type(states, wf_type)
    return None


async def linear_update_issue(
    issue_identifier: str,
    *,
    state_target: str | None = None,
    title: str | None = None,
    description: str | None = None,
    description_append: str | None = None,
    priority: int | None = None,
) -> dict[str, Any]:
    """Apply Linear ``issueUpdate`` using the workspace that owns the row.

    At least one updatable field must be present or this raises."""

    ctx = await get_linear_issue_with_api_key(issue_identifier)
    if not ctx:
        raise LinearClientError(f"Issue {issue_identifier} not found in Linear.")

    issue, api_key = ctx

    blobs: dict[str, Any] = {}
    if title is not None and str(title).strip():
        blobs["title"] = str(title).strip()
    desc_out: str | None = None
    if description is not None:
        desc_out = str(description)
    if description_append is not None and str(description_append).strip():
        app = str(description_append).strip()
        prev = ""
        if desc_out is None:
            prev = ((issue.get("description") or "").rstrip())
        else:
            prev = desc_out.rstrip()
        spacer = "\n\n" if prev else ""
        desc_out = f"{prev}{spacer}{app}"
    if desc_out is not None:
        blobs["description"] = desc_out
    if priority is not None:
        blobs["priority"] = int(priority)

    team = issue.get("team") or {}
    team_id = team.get("id")
    inner: dict[str, Any] = dict(blobs)

    if state_target:
        if not isinstance(team_id, str) or not team_id.strip():
            raise LinearClientError("Issue has no team; cannot infer workflow columns.")
        states = await fetch_team_workflow_states(api_key, team_id.strip())
        if not states:
            raise LinearClientError("Unable to fetch workflow columns for this team.")
        sid = workflow_state_id_for_target(states, state_target)
        if not sid:
            raise LinearClientError(
                f"Could not resolve workflow state '{state_target}' on this team's board.",
            )
        inner["stateId"] = sid

    if not inner:
        raise LinearClientError(
            "No updates requested — supply state, title, description, append, "
            "or priority.",
        )

    issue_uuid = issue.get("id")
    if not issue_uuid:
        raise LinearClientError("Linear responded without an internal issue UUID.")

    data = await linear_graphql_with_key(
        api_key,
        _ISSUE_UPDATE_MUTATION,
        {"issueId": issue_uuid, "input": inner},
    )
    mutation = data.get("issueUpdate") or {}
    if mutation.get("success") is not True:
        raise LinearClientError(
            "Linear issueUpdate failed or was declined. Check permissions and IDs."
        )
    refreshed = await get_linear_issue(issue_identifier)
    return refreshed or (mutation.get("issue") or issue)


async def get_my_linear_issues(limit: int = 25) -> list[dict[str, Any]]:
    """Backward-compatible name — fans out via ``aggregate_open_assigned``."""
    return await aggregate_open_assigned_issues(limit)


def format_linear_issue_summary(issue_id: str, issue: dict[str, Any]) -> str:
    """Render an issue dict into the multiline ``summary`` field shown in
    the Vmax structured response."""
    title = issue.get("title") or "(no title)"
    state = (issue.get("state") or {}).get("name") or "(unknown)"
    assignee = (issue.get("assignee") or {}).get("name") or "Unassigned"
    priority = issue.get("priority")
    project = (issue.get("project") or {}).get("name")
    url = issue.get("url") or ""
    description = (issue.get("description") or "").strip() or "No description."
    labels = [
        label.get("name")
        for label in ((issue.get("labels") or {}).get("nodes") or [])
        if label.get("name")
    ]

    lines = [
        f"{issue_id}: {title}",
        "",
        f"Status: {state}",
        f"Assignee: {assignee}",
    ]
    if priority is not None:
        lines.append(f"Priority: {priority}")
    if project:
        lines.append(f"Project: {project}")
    if labels:
        lines.append(f"Labels: {', '.join(labels)}")
    if url:
        lines.append(f"URL: {url}")
    lines.append("")
    lines.append("Description:")
    lines.append(description)
    return "\n".join(lines)


def format_linear_speakable(issue_id: str, issue: dict[str, Any]) -> str:
    """Short single-sentence summary safe for TTS."""
    title = issue.get("title") or "(no title)"
    state = (issue.get("state") or {}).get("name") or "unknown"
    assignee = (issue.get("assignee") or {}).get("name") or "Unassigned"
    return f"{issue_id} is {title}. Status is {state}. Assigned to {assignee}."


# Linear priority encoding: 1=Urgent, 2=High, 3=Medium, 4=Low, 0=No priority.
# We want highest-priority work first, with "no priority" pushed to the
# bottom. Treat unset/None the same as "no priority".
_PRIORITY_LABEL: dict[int, str] = {
    0: "No priority",
    1: "Urgent",
    2: "High",
    3: "Medium",
    4: "Low",
}


def _priority_sort_key(issue: dict[str, Any]) -> tuple[int, str]:
    raw = issue.get("priority")
    try:
        priority = int(raw) if raw is not None else 0
    except (TypeError, ValueError):
        priority = 0
    # 1-4 sort naturally (urgent first). 0 ("no priority") sinks to the
    # bottom by mapping to 99. Tiebreak by identifier for stable output.
    sort_priority = priority if 1 <= priority <= 4 else 99
    return (sort_priority, issue.get("identifier") or "")


def sort_my_issues(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(issues, key=_priority_sort_key)


def _truncate_block(text: str, max_chars: int) -> str:
    stripped = (text or "").strip()
    if len(stripped) <= max_chars:
        return stripped
    return stripped[: max_chars - 1].rstrip() + "\u2026"


def _recent_comment_preview_lines(
    issue: dict[str, Any],
    *,
    max_comments: int = 3,
    body_max_chars: int = 200,
) -> list[str]:
    nodes = ((issue.get("comments") or {}).get("nodes") or [])[:]
    if not nodes:
        return []

    def _ts(c: dict[str, Any]) -> str:
        return str(c.get("createdAt") or "")

    nodes.sort(key=_ts, reverse=True)
    out: list[str] = []
    for c in nodes[:max_comments]:
        body_raw = (c.get("body") or "").strip()
        author = (
            ((c.get("user") or {}).get("name") or "").strip() or "(unknown)"
        )
        body = _truncate_block(body_raw, body_max_chars).replace("\n", " ")
        out.append(f"   · {author}: {body}")

    tail = len(nodes) - max_comments if len(nodes) > max_comments else 0
    if tail > 0:
        out.append(f"   · …and {tail} older comment(s) not shown")
    return out


MY_ISSUES_DESC_MAX_CHARS = 700


def format_my_issues_summary(issues: list[dict[str, Any]]) -> str:
    if not issues:
        return "You have no open issues assigned to you in Linear."

    ordered = sort_my_issues(issues)
    lines = [f"You have {len(ordered)} open issue(s) assigned to you:", ""]
    for idx, issue in enumerate(ordered, start=1):
        identifier = issue.get("identifier") or "(no id)"
        title = issue.get("title") or "(no title)"
        state = (issue.get("state") or {}).get("name") or "unknown"
        priority_raw = issue.get("priority")
        try:
            priority_num = int(priority_raw) if priority_raw is not None else 0
        except (TypeError, ValueError):
            priority_num = 0
        priority_label = _PRIORITY_LABEL.get(priority_num, "Unknown")

        project = (issue.get("project") or {}).get("name")
        ws_hint = issue.get("_workspace_name")
        line_one = (
            f"{idx}. [{ws_hint}] {identifier} — {title}"
            if ws_hint
            else f"{idx}. {identifier} — {title}"
        )
        bits = [line_one, f"   {state} · {priority_label}"]
        if project:
            bits[-1] += f" · {project}"
        url = issue.get("url")
        if url:
            bits.append(f"   {url}")

        team = issue.get("team") or {}
        team_label = (
            ((team.get("key") or team.get("name") or "").strip()) or ""
        )
        if team_label:
            bits.append(f"   Team: {team_label}")

        estimate = issue.get("estimate")
        if estimate is not None:
            bits.append(f"   Estimate pts: {estimate}")

        due = (issue.get("dueDate") or "").strip()
        if due:
            bits.append(f"   Due: {due}")

        branch = (issue.get("branchName") or "").strip()
        if branch:
            bits.append(f"   Branch: {branch}")

        cycle = issue.get("cycle") or {}
        cycle_name = (cycle.get("name") or "").strip()
        if cycle_name:
            bits.append(f"   Cycle: {cycle_name}")

        labels = [
            label.get("name")
            for label in ((issue.get("labels") or {}).get("nodes") or [])
            if label.get("name")
        ]
        if labels:
            bits.append(f"   Labels: {', '.join(labels)}")

        creator = (
            ((issue.get("creator") or {}).get("name") or "").strip() or ""
        )
        if creator:
            bits.append(f"   Created by: {creator}")

        desc = issue.get("description")
        desc_s = ((desc or "").strip()) or "(no description)"
        bits.append(f"   Description: {_truncate_block(desc_s, MY_ISSUES_DESC_MAX_CHARS)}")

        comment_lines = _recent_comment_preview_lines(issue)
        if comment_lines:
            bits.append("   Recent comments:")
            bits.extend(comment_lines)

        lines.extend(bits)
        lines.append("")

    return "\n".join(lines).rstrip()


def format_my_issues_speakable(issues: list[dict[str, Any]]) -> str:
    if not issues:
        return "You have no open Linear issues assigned to you."
    ordered = sort_my_issues(issues)
    top = ordered[0]
    identifier = top.get("identifier") or "the first one"
    title = top.get("title") or "(no title)"
    count = len(ordered)
    if count == 1:
        return f"You have one open issue: {identifier}, {title}."
    return (
        f"You have {count} open issues. Your top one is {identifier}: {title}."
    )
