import { useRef, useState } from "react";

// Push-to-talk recorder. Returns base64 audio + mime, suitable for Whisper.
export function useAudio() {
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    if (recRef.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      streamRef.current = null;
      throw e instanceof Error ? e : new Error("Microphone access failed");
    }
    streamRef.current = stream;
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime });
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      throw e instanceof Error ? e : new Error("Recording not supported");
    }
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onerror = () => {
      /* stop() will still run from user gesture */
    };
    rec.start();
    recRef.current = rec;
    setRecording(true);
  }

  function discard() {
    const rec = recRef.current;
    if (rec) {
      try {
        rec.onstop = null;
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    chunksRef.current = [];
    setRecording(false);
  }

  function stop(): Promise<{ audioBase64: string; mimeType: string } | null> {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);
        resolve(null);
        return;
      }
      rec.onstop = async () => {
        const mimeType = rec.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recRef.current = null;
        setRecording(false);
        if (blob.size === 0) return resolve(null);
        const b64 = bufferToBase64(await blob.arrayBuffer());
        resolve({ audioBase64: b64, mimeType });
      };
      try {
        rec.stop();
      } catch {
        discard();
        resolve(null);
      }
    });
  }

  const isCapturing = () => recRef.current !== null;

  return { recording, start, stop, discard, isCapturing };
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}
