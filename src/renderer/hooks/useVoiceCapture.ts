import { useEffect, useRef, useState } from "react";

// Click-to-listen voice capture with VAD (auto-stop on silence).
// Lifecycle: idle → listening → finalizing → idle
//   • caller calls start(); we open mic + recorder.
//   • we run an AnalyserNode RMS loop and look for speech onset.
//   • once speech is detected, a sustained drop below threshold for
//     `silenceMs` ends the recording.
//   • a hard `maxMs` ceiling guarantees we don't get stuck.
//   • returns { audioBase64, mimeType } via the resolved Promise from start().

type StartOptions = {
  silenceMs?: number;
  maxMs?: number;
  threshold?: number;
};

type Result = { audioBase64: string; mimeType: string };

export function useVoiceCapture() {
  const [state, setState] = useState<"idle" | "listening" | "finalizing">("idle");
  const [level, setLevel] = useState(0); // 0..1, drives the meter UI
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => () => { cleanup(); }, []);

  function cleanup() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    recRef.current = null;
    setState("idle");
    setLevel(0);
  }

  async function start({ silenceMs = 1200, maxMs = 15000, threshold = 0.025 }: StartOptions = {}): Promise<Result | null> {
    if (state !== "idle") return null;
    cancelRef.current = false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.start();
    recRef.current = rec;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    setState("listening");
    const startedAt = performance.now();
    let speechStartedAt: number | null = null;
    let lastLoudAt: number | null = null;

    return new Promise<Result | null>((resolve) => {
      const stopAndResolve = async () => {
        if (!recRef.current) { cleanup(); resolve(null); return; }
        setState("finalizing");
        recRef.current.onstop = async () => {
          const blob = new Blob(chunks, { type: mime });
          cleanup();
          if (cancelRef.current || blob.size === 0) return resolve(null);
          const buf = await blob.arrayBuffer();
          resolve({ audioBase64: bufToBase64(buf), mimeType: mime });
        };
        recRef.current.stop();
      };

      const tick = () => {
        if (!audioCtxRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 6));

        const now = performance.now();
        if (rms > threshold) {
          if (speechStartedAt === null) speechStartedAt = now;
          lastLoudAt = now;
        }
        // Auto-stop conditions:
        const elapsed = now - startedAt;
        const silenceFor = lastLoudAt !== null ? now - lastLoudAt : 0;
        const speechFor = speechStartedAt !== null ? now - speechStartedAt : 0;

        if (cancelRef.current) return stopAndResolve();
        if (elapsed >= maxMs) return stopAndResolve();
        if (speechFor > 400 && silenceFor >= silenceMs) return stopAndResolve();

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    });
  }

  function cancel() {
    cancelRef.current = true;
  }

  return { state, level, start, cancel };
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}
