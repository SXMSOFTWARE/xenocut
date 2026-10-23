import { useEffect, useState } from "react";
import { HERO } from "../data/demo";
import { GRADE_FILTER } from "../lib/grades";
import { useMedia } from "../context/MediaContext";
import { useEditorStore } from "../store/editorStore";

export function PreviewArea() {
  const videoRef = useMedia().videoRef;
  const handleLoaded = useMedia().handleLoaded;
  const togglePlay = useMedia().togglePlay;
  const videoUrl = useEditorStore((state) => state.videoUrl);
  const playing = useEditorStore((state) => state.playing);
  const grade = useEditorStore((state) => state.grade);
  const guides = useEditorStore((state) => state.guides);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const showToast = useEditorStore((state) => state.showToast);
  const failVideoImport = useEditorStore((state) => state.failVideoImport);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [videoUrl]);

  return (
    <>
      <div
        className="media-layer"
        style={{ filter: GRADE_FILTER[grade] }}
        data-testid="preview"
        onClick={togglePlay}
      >
        <img
          className={`media-fill${playing && !videoUrl ? " is-drifting" : ""}`}
          src={HERO}
          alt="Extreme close-up of an eye framed by crimson feathers and gold makeup"
          draggable={false}
        />
        {videoUrl && (
          <video
            ref={videoRef}
            className="media-fill"
            src={videoUrl}
            poster={HERO}
            playsInline
            preload="auto"
            style={{ opacity: ready ? 1 : 0 }}
            onLoadedMetadata={(event) => handleLoaded(event.currentTarget)}
            onLoadedData={() => setReady(true)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              useEditorStore.setState({ currentTime: useEditorStore.getState().duration });
            }}
            onError={() => {
              setReady(false);
              failVideoImport();
              showToast("Couldn't play that video. Try an MP4 or WebM.");
            }}
          />
        )}
      </div>
      <div className="preview-scrim" />
      {guides && (
        <div className="guides" aria-hidden="true">
          <span className="v1" />
          <span className="v2" />
          <span className="h1" />
          <span className="h2" />
        </div>
      )}
    </>
  );
}
