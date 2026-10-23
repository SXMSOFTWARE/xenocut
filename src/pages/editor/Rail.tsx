import { ArrowLeft, AudioWaveform, Clapperboard, Mic, Music, Type } from "lucide-react";
import type { ComponentType } from "react";
import { useT, type Key } from "../../i18n";
import { useEditorUi, type PanelId } from "../../store/editorUi";
import { ThreeCirclesIcon, TransitionsIcon } from "./icons";
import { leaveEditor } from "./commands";

const ITEMS: { id: PanelId; icon: ComponentType<{ size?: number; strokeWidth?: number }>; label: Key }[] = [
  { id: "media", icon: Clapperboard, label: "rail.media" },
  { id: "voice", icon: Mic, label: "rail.voice" },
  { id: "music", icon: Music, label: "rail.music" },
  { id: "effects", icon: TransitionsIcon, label: "rail.effects" },
  { id: "audio", icon: AudioWaveform, label: "rail.audio" },
  { id: "color", icon: ThreeCirclesIcon, label: "rail.color" },
  { id: "text", icon: Type, label: "rail.text" },
];

/** The reference's vertical rail of round tool buttons; each opens its panel on the right. */
export function Rail() {
  const t = useT();
  const panel = useEditorUi((s) => s.panel);
  return (
    <nav className="rail" aria-label="Tools">
      <button className="rail-btn" onClick={() => void leaveEditor()} title={t("editor.back")} aria-label={t("editor.back")}>
        <ArrowLeft size={15} strokeWidth={1.75} />
      </button>
      {ITEMS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          className={`rail-btn${panel === id ? " active" : ""}`}
          aria-pressed={panel === id}
          title={t(label)}
          aria-label={t(label)}
          onClick={() => useEditorUi.setState({ panel: panel === id ? null : id })}
        >
          <Icon size={15} strokeWidth={1.75} />
        </button>
      ))}
    </nav>
  );
}
