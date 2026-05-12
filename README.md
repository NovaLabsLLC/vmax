# vmax

A "Jarvis-like" macOS desktop assistant. Lives as a thin always-on-top bar at the bottom of your screen, sees what you're working on (with permission), and answers voice queries with screen-aware, step-by-step instructions.

## Stack

- Electron (always-on-top, transparent, frameless window)
- React + TypeScript + Tailwind CSS (renderer)
- Vite (renderer dev/build)
- Whisper API (speech-to-text)
- OpenAI `gpt-4o-mini` **or** Claude `claude-sonnet-4-6` (vision + reasoning)
- Browser `speechSynthesis` for TTS

## Setup

```bash
npm install
cp .env.example .env
# add OPENAI_API_KEY (and optionally ANTHROPIC_API_KEY)
npm run dev
```

`npm run dev` runs Vite (renderer) and Electron together.

To build & run a production renderer:

```bash
npm run build
npm start
```

## Permissions (macOS)

- **Microphone**: prompted automatically the first time you push-to-talk.
- **Screen Recording**: click **Enable screen** in the bar. If the system has previously denied it, the app opens System Settings → Privacy & Security → Screen Recording so you can toggle it on (then restart the app).

## Usage

- **Hold** the mic button (or press **⌘⇧Space**) to talk. Release to send.
- The bar shows a status dot: idle / listening / thinking.
- The latest screenshot (1 fps, kept only in memory, last 10 frames) is sent alongside your transcript.
- The expandable panel above the bar shows the assistant's answer; the answer is also spoken aloud.
- Or type into the input and press **Enter** to skip voice.

### Vmax Workspace (agents and Linear)

- The **task** textarea in Workspace is editable: type freely, paste from Linear rows, refine after voice, then plan with the send button or **⌘↵**.
- Under **My Tasks**, use **Edit** on any row to save **title**, **description**, or **due date** to Linear. **Done** completes the issue in Linear.

## Design notes

- API keys live in the Electron main process; the renderer talks to them via IPC, so secrets never reach the web context.
- Frames are captured via `getDisplayMedia` and downscaled to ~1280px JPEG (quality 0.6) before being sent — keeps payloads small.
- The model is **only** queried when the user speaks/types; frames are not streamed continuously.
- Active app name (e.g. "Adobe Premiere Pro") is detected via `osascript` and included in the prompt when available.

## Project layout

```
electron/
  main.js         # window + IPC + global hotkey
  preload.js      # contextBridge surface
src/renderer/
  App.tsx
  index.tsx
  styles.css
  components/
    BottomBar.tsx
    ResponsePanel.tsx
  hooks/
    useAudio.ts
    useScreen.ts
utils/
  aiClient.js     # OpenAI / Anthropic wrappers
  activeApp.js    # macOS frontmost-app helper
```
