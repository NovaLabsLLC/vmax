# Vmax backend

FastAPI service that owns the OpenAI / Anthropic API keys. The Electron
app (`utils/aiClient.js`) is a thin HTTP client that talks to this server;
no model keys live on the client anymore.

## Endpoints

All return JSON; all are POST except `/healthz`.

| Method | Path                     | Purpose                                                  |
| ------ | ------------------------ | -------------------------------------------------------- |
| GET    | `/healthz`               | Liveness probe                                           |
| POST   | `/v1/transcribe`         | Whisper: `{ audio_base64, mime_type }` → `{ text }`      |
| POST   | `/v1/tts`                | OpenAI TTS: `{ text, voice }` → `{ audio_base64, mime_type }` |
| POST   | `/v1/ask`                | Vmax assistant chat with optional screenshot + history   |
| POST   | `/v1/plan`               | Plan a task against repo + diff                          |
| POST   | `/v1/explain-failure`    | Diagnose a failed shell command                          |
| POST   | `/v1/summarize-diff`     | Summarize a git diff                                     |
| POST   | `/v1/task`               | Turn a freeform prompt into a strict `VmaxTask` (planner) |

`/v1/ask`, `/v1/plan`, `/v1/explain-failure`, `/v1/summarize-diff` all
return a structured response shaped like:

```json
{
  "structured": {
    "summary": "...",
    "what_vmax_sees": "...",
    "likely_problem": "...",
    "next_steps": ["..."],
    "cursor_prompt": "...",
    "claude_prompt": "...",
    "suggested_commands": ["..."],
    "execution_recommendation": "none|run_locally|cursor|claude_code|mixed",
    "speakable_summary": "..."
  },
  "parse_warning": false
}
```

The Electron client maps this into `Plan` / `Failure` / `Diff` / `AskPanel`
shapes for the renderer (see `utils/aiClient.js`).

## Run locally

Requires Python 3.11+.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# fill in OPENAI_API_KEY (and optionally ANTHROPIC_API_KEY)

uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Confirm it's up:

```bash
curl http://127.0.0.1:8000/healthz
# → {"ok": true}
```

Point the Electron app at it via `VMAX_BACKEND_URL` in the project's root
`.env` (defaults to `http://127.0.0.1:8000`).

## Auth

None right now. The service binds to `127.0.0.1` by default — do not
expose this to the internet without first adding an auth check.

## Provider selection

- If `OPENAI_API_KEY` is set, OpenAI is used for chat completions.
- If only `ANTHROPIC_API_KEY` is set, Anthropic is used.
- Whisper transcription and TTS always require `OPENAI_API_KEY`.

Override models via `OPENAI_MODEL`, `OPENAI_MODEL_TEXT`, `ANTHROPIC_MODEL`,
`OPENAI_MODEL_TASK`, `ANTHROPIC_MODEL_TASK`. The `_TASK` variants drive
the cheap/fast model used by `POST /v1/task` so the task planner stays
snappy without affecting `/v1/ask` quality.

## /v1/task shape

```json
// request
{
  "prompt": "...",
  "repo": { "ok": true, "name": "...", "branch": "...", "root": "...",
            "changed_files": ["..."] },
  "target_branch": "main"
}
// response
{
  "ok": true,
  "task": {
    "id": "task_…",
    "title": "...", "goal": "...",
    "repo": { "name": "...", "path": "...",
              "baseBranch": "main", "targetBranch": "main" },
    "type": "feature", "priority": "medium",
    "filesToInspect": ["..."], "constraints": ["..."],
    "successCriteria": ["..."], "validationCommands": ["npm run test"],
    "riskLevel": "low",
    "approvalPolicy": { "requireApprovalBefore": ["..."] },
    "agent": { "preferred": "claude_code", "reason": "..." },
    "outputFormat": ["..."]
  },
  "parse_warning": false,
  "error": null
}
```

If the model returns malformed JSON, the server still returns a safe
fallback `task` with `parse_warning: true` and `error` set to the parse
hint. `ok` is `false` only when the prompt is empty or the model reply
fails final validation.
