"""Safety paragraph the LLM sees in every system prompt.

Ported verbatim from utils/commandSafety.js so the system prompts match
between the old client-only behaviour and the new backend behaviour.
"""

ALLOWLIST_SUMMARY = (
    "npm install, npm run lint, npm run test, npm run typecheck, "
    "git status, git diff, git diff --stat"
)

AGENT_PROMPT_SAFETY_PARAGRAPH = (
    "Hard safety rules (Vmax demo \u2014 Cursor, Claude Code, OpenClaw, "
    "etc.): The app only runs this exact allowlist in the UI shell: "
    f"{ALLOWLIST_SUMMARY}. Do not suggest any other shell command for the "
    "automated runner. Do not instruct production deploys, force pushes, "
    "git reset/clean that drops work, secret dumps (printenv, .env cats, "
    "private keys), or file deletion without explicit human approval."
)
