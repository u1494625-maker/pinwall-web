/**
 * Generates a single still-frame JPEG thumbnail from a video file, entirely
 * client-side (off-DOM <video> + <canvas>) — used only at publish time so a
 * video post can have a real cover image on the Map instead of a generic
 * play-glyph placeholder. Never used for playback; Post Detail always plays
 * the real uploaded video file.
 */
export async function generateVideoThumbnail(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);

  try {
    return await new Promise<Blob>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.src = objectUrl;

      video.addEventListener("loadeddata", () => {
        // A hair past 0 — some encoders leave the very first frame black —
        // but still effectively "the start" of the video.
        video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
      });

      video.addEventListener("seeked", () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas isn't supported in this browser."));
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Thumbnail encoding failed."))),
          "image/jpeg",
          0.8,
        );
      });

      video.addEventListener("error", () => reject(new Error("Couldn't load this video to generate a thumbnail.")));
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
