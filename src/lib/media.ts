function drawFrame(
  video: HTMLVideoElement,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): string {
  context.drawImage(video, 0, 0, width, height);
  return context.canvas.toDataURL("image/jpeg", 0.72);
}

function waitFor(target: HTMLVideoElement, event: "loadeddata" | "seeked" | "error"): Promise<void> {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not read a frame from this video."));
    };
    const cleanup = () => {
      target.removeEventListener(event, onReady);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(event, onReady);
    target.addEventListener("error", onError);
  });
}

export async function captureThumbnails(src: string, duration: number, count = 8): Promise<string[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;

  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not draw thumbnails.");

  try {
    await waitFor(video, "loadeddata");
    const safeCount = Math.max(1, Math.min(count, 8));
    const frames: string[] = [];

    for (let index = 0; index < safeCount; index += 1) {
      const ratio = safeCount === 1 ? 0 : index / (safeCount - 1);
      const target = Math.min(Math.max(duration * ratio, 0), Math.max(duration - 0.04, 0));
      if (Math.abs(video.currentTime - target) < 0.03) {
        frames.push(drawFrame(video, context, canvas.width, canvas.height));
        continue;
      }
      const seeked = waitFor(video, "seeked");
      video.currentTime = target;
      await seeked;
      frames.push(drawFrame(video, context, canvas.width, canvas.height));
    }

    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|mkv|m4v|ogv)$/i.test(file.name);
}
