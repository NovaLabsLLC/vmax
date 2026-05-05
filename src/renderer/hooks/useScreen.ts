import { useEffect, useRef, useState } from "react";

// Captures one frame per second from the primary display via getDisplayMedia.
// Stores the latest JPEG (base64) in memory only — no disk persistence.
// Frames are downscaled to ~1280px JPEG q=0.6 to keep payloads small.

const FRAME_INTERVAL_MS = 1000;
const TARGET_WIDTH = 1280;

type Status = "idle" | "requesting" | "granted" | "denied";

export function useScreen() {
  const [status, setStatus] = useState<Status>("idle");
  const latestRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => () => stop(), []);

  async function start() {
    if (status === "granted" || status === "requesting") return;
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 2 } as MediaTrackConstraints,
        audio: false,
      });
      streamRef.current = stream;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      videoRef.current = video;

      canvasRef.current = document.createElement("canvas");
      setStatus("granted");
      // Detect user-initiated stop (e.g. from the menubar share UI).
      stream.getVideoTracks()[0].addEventListener("ended", () => stop());

      intervalRef.current = window.setInterval(captureFrame, FRAME_INTERVAL_MS);
      // capture once immediately so getLatestFrame() is non-null fast
      setTimeout(captureFrame, 100);
    } catch (err) {
      console.error("screen capture failed", err);
      setStatus("denied");
    }
  }

  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.min(1, TARGET_WIDTH / vw);
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    latestRef.current = dataUrl.split(",")[1] || null;
  }

  function stop() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    videoRef.current = null;
    canvasRef.current = null;
    latestRef.current = null;
    setStatus("idle");
  }

  return { status, start, stop, getLatestFrame: () => latestRef.current };
}
