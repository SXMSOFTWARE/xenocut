import { RectangleHorizontal, RectangleVertical, SlidersHorizontal, Square, Star, Timer } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMedia } from "../context/MediaContext";
import { ASPECTS, GRADES, RESOLUTIONS } from "../lib/grades";
import { formatTimestamp } from "../lib/time";
import { useEditorStore } from "../store/editorStore";
import type { Aspect } from "../types";

export type SettingsMenu = "aspect" | "resolution" | "grade" | "settings" | null;

interface QuickSettingsProps {
  menu: SettingsMenu;
  onMenu: (menu: SettingsMenu) => void;
}

export function QuickSettings({ menu, onMenu }: QuickSettingsProps) {
  const aspect = useEditorStore((state) => state.aspect);
  const resolution = useEditorStore((state) => state.resolution);
  const grade = useEditorStore((state) => state.grade);
  const duration = useEditorStore((state) => state.duration);
  const clips = useEditorStore((state) => state.clips);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const setAspect = useEditorStore((state) => state.setAspect);
  const setResolution = useEditorStore((state) => state.setResolution);
  const setGrade = useEditorStore((state) => state.setGrade);
  const seek = useMedia().seek;

  const selected = clips.find((clip) => clip.id === selectedClipId);
  const length = selected ? Math.max(0, selected.end - selected.start) : duration;
  const lengthLabel = formatTimestamp(length);

  return (
    <div className="settings-pill" data-testid="quick-settings">
      <Chip
        label={aspect}
        icon={<AspectIcon aspect={aspect} />}
        open={menu === "aspect"}
        onToggle={() => onMenu(menu === "aspect" ? null : "aspect")}
      >
        {ASPECTS.map((option) => (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={option === aspect}
            onClick={() => {
              setAspect(option);
              onMenu(null);
            }}
          >
            <AspectIcon aspect={option} />
            {option}
          </button>
        ))}
      </Chip>
      <Chip
        label={resolution}
        icon={<Star size={13} strokeWidth={1.75} />}
        open={menu === "resolution"}
        onToggle={() => onMenu(menu === "resolution" ? null : "resolution")}
      >
        {RESOLUTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={option === resolution}
            onClick={() => {
              setResolution(option);
              onMenu(null);
            }}
          >
            <Star size={13} strokeWidth={1.75} />
            {option}
          </button>
        ))}
      </Chip>
      <button
        type="button"
        className="setting-chip"
        aria-label={`Selected clip length ${lengthLabel}`}
        onClick={() => seek(selected?.start ?? 0)}
      >
        <Timer size={13} strokeWidth={1.75} />
        {lengthLabel}
      </button>
      <Chip
        label={grade}
        icon={<SlidersHorizontal size={13} strokeWidth={1.75} />}
        open={menu === "grade"}
        onToggle={() => onMenu(menu === "grade" ? null : "grade")}
      >
        {GRADES.map((option) => (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={option === grade}
            onClick={() => {
              setGrade(option);
              onMenu(null);
            }}
          >
            {option}
          </button>
        ))}
      </Chip>
    </div>
  );
}

function Chip({
  label,
  icon,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={anchorRef} type="button" className="setting-chip" aria-expanded={open} onClick={onToggle}>
        {icon}
        {label}
      </button>
      <Popover open={open} anchorRef={anchorRef}>
        {children}
      </Popover>
    </div>
  );
}

export function Popover({
  open,
  anchorRef,
  align = "left",
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const node = anchorRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setStyle({
        position: "fixed",
        bottom: window.innerHeight - rect.top + 8,
        left: align === "left" ? rect.left : "auto",
        right: align === "right" ? window.innerWidth - rect.right : "auto",
        zIndex: 50,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [align, anchorRef, open]);

  if (!open || !style) return null;
  return createPortal(
    <div className="menu" style={style} role="menu">
      {children}
    </div>,
    document.body,
  );
}

function AspectIcon({ aspect }: { aspect: Aspect }) {
  if (aspect === "16:9") return <RectangleHorizontal size={13} strokeWidth={1.75} />;
  if (aspect === "1:1") return <Square size={13} strokeWidth={1.75} />;
  return <RectangleVertical size={13} strokeWidth={1.75} />;
}
