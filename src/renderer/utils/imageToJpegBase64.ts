/** Downscale large images and encode as JPEG base64 (no data-URL prefix) for vision APIs. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export async function encodeImageFileAsJpegBase64(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    let { width, height } = bmp;
    if (width < 1 || height < 1) throw new Error("Invalid image dimensions");
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(bmp, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const prefix = "data:image/jpeg;base64,";
    if (!dataUrl.startsWith(prefix)) throw new Error("Unexpected image encoding");
    return dataUrl.slice(prefix.length);
  } finally {
    bmp.close();
  }
}
