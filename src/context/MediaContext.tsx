import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { fileUrl, isTauri, pickPath } from "../lib/audioApi";
import { captureThumbnails, isVideoFile } from "../lib/media";
import { snapTime } from "../lib/clips";
import { clamp } from "../lib/time";
import { useEditorStore } from "../store/editorStore";

interface MediaContextValue {
  videoRef: RefObject<HTMLVideoElement | null>;
  openFilePicker: () => void;
  importFile: (file: File) => void;
  seek: (time: number) => void;
  togglePlay: () => void;
  skip: (to: "start" | "end" | number) => void;
  handleLoaded: (video: HTMLVideoElement) => void;
}

const MediaContext = createContext<MediaContextValue | null>(null);

export function MediaProvider({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const tokenRef = useRef(0);

  const seek = useCallback((time: number) => {
    const { duration, snap, clips } = useEditorStore.getState();
    let next = clamp(time, 0, duration || 0);
    if (snap) next = snapTime(next, clips, Math.max(0.2, duration * 0.008));
    useEditorStore.setState({ currentTime: next });
    const video = videoRef.current;
    if (video && useEditorStore.getState().videoUrl && Number.isFinite(video.duration)) {
      if (Math.abs(video.currentTime - next) > 0.04) video.currentTime = next;
    }
  }, []);

  const togglePlay = useCallback(() => {
    const { videoUrl, playing, currentTime, duration } = useEditorStore.getState();
    const video = videoRef.current;
    if (video && videoUrl) {
      if (video.paused) {
        if (video.currentTime >= (video.duration || duration) - 0.08) video.currentTime = 0;
        void video.play().catch(() => {
          useEditorStore.getState().showToast("Playback was blocked by the browser.");
        });
      } else {
        video.pause();
      }
      return;
    }
    if (!playing && currentTime >= duration - 0.05) {
      useEditorStore.setState({ currentTime: 0, playing: true });
      return;
    }
    useEditorStore.setState({ playing: !playing });
  }, []);

  const skip = useCallback(
    (to: "start" | "end" | number) => {
      const { duration, currentTime } = useEditorStore.getState();
      if (to === "start") {
        seek(0);
        return;
      }
      if (to === "end") {
        seek(duration);
        const video = videoRef.current;
        if (video && !video.paused) video.pause();
        useEditorStore.setState({ playing: false });
        return;
      }
      seek(currentTime + to);
    },
    [seek],
  );

  const importFile = useCallback((file: File) => {
    if (!isVideoFile(file)) {
      useEditorStore.getState().showToast("Choose a video file to import.");
      return;
    }
    const url = URL.createObjectURL(file);
    tokenRef.current += 1;
    useEditorStore.getState().beginVideoImport(url, file.name, null);
  }, []);

  const handleLoaded = useCallback((video: HTMLVideoElement) => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      useEditorStore.getState().showToast("This file doesn't have a readable duration.");
      useEditorStore.getState().failVideoImport();
      return;
    }
    const token = tokenRef.current;
    const src = video.currentSrc || video.src;
    void captureThumbnails(src, duration)
      .then((frames) => {
        if (token !== tokenRef.current) return;
        useEditorStore.getState().completeVideoImport(duration, frames);
      })
      .catch(() => {
        if (token !== tokenRef.current) return;
        useEditorStore.getState().completeVideoImport(duration, []);
        useEditorStore.getState().showToast("Thumbnails couldn't be generated. Playback still works.");
      });
  }, []);

  const openFilePicker = useCallback(() => {
    void (async () => {
      if (!isTauri()) {
        fileRef.current?.click();
        return;
      }
      const selected = await pickPath("video");
      if (!selected) return;
      const name = selected.split(/[/\\]/).pop() || "video";
      tokenRef.current += 1;
      useEditorStore.getState().beginVideoImport(await fileUrl(selected), name, selected);
    })();
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let running = false;

    const loop = (now: number) => {
      const { playing, videoUrl, currentTime, duration } = useEditorStore.getState();
      if (!playing) {
        running = false;
        return;
      }
      const video = videoRef.current;
      if (video && videoUrl && !video.paused) {
        useEditorStore.setState({ currentTime: video.currentTime });
      } else if (!videoUrl) {
        const next = currentTime + (now - last) / 1000;
        if (next >= duration) useEditorStore.setState({ currentTime: duration, playing: false });
        else useEditorStore.setState({ currentTime: next });
      }
      last = now;
      frame = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    };

    if (useEditorStore.getState().playing) start();
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.playing && !previous.playing) start();
      if (!state.playing && previous.playing) {
        running = false;
        cancelAnimationFrame(frame);
      }
    });

    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        skip(event.shiftKey ? -5 : -1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        skip(event.shiftKey ? 5 : 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        skip("start");
      } else if (event.key === "End") {
        event.preventDefault();
        skip("end");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [skip, togglePlay]);

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      importFile(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [importFile]);

  const value = useMemo(
    () => ({ videoRef, openFilePicker, importFile, seek, togglePlay, skip, handleLoaded }),
    [handleLoaded, importFile, openFilePicker, seek, skip, togglePlay],
  );

  return (
    <MediaContext.Provider value={value}>
      {children}
      <input
        ref={fileRef}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.mkv,.m4v,.ogv"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) importFile(file);
        }}
      />
    </MediaContext.Provider>
  );
}

export function useMedia(): MediaContextValue {
  const value = useContext(MediaContext);
  if (!value) throw new Error("useMedia must be used within MediaProvider");
  return value;
}
