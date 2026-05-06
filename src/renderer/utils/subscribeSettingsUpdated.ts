/** Subscribes to main-process settings broadcasts. No-ops if preload is older than Talk Back (avoids crashing). */
export function subscribeSettingsUpdated(
  cb: (settings: {
    talkBack?: boolean;
    cursorAutoSend?: boolean;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    defaultProvider?: string;
  }) => void,
): () => void {
  const sub = window.exec?.onSettingsUpdated;
  if (typeof sub !== "function") {
    console.warn(
      "[exec] onSettingsUpdated missing — restart the Electron app so the preload bridge picks up the latest build.",
    );
    return () => {};
  }
  return sub(cb);
}
