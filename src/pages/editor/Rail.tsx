import { ArrowLeft, SlidersHorizontal, Wand2, AudioWaveform, Captions, Clapperboard, Mic, AudioLines, MicVocal, Music, Sparkles, Sticker, Type } from "lucide-react";
import type { ComponentType } from "react";
import { useT, type Key } from "../../i18n";
import { useEditorUi, type PanelId } from "../../store/editorUi";
import { ThreeCirclesIcon, TransitionsIcon } from "./icons";
import { leaveEditor } from "./commands";

/** `adv`: hidden by the Basic layout, which keeps only the everyday tools. */
const ITEMS: { id: PanelId; icon: ComponentType<{ size?: number; strokeWidth?: number }>; label: Key; adv?: boolean }[] = [
  { id: "media", icon: Clapperboard, label: "rail.media" },
  { id: "voice", icon: Mic, label: "rail.voice", adv: true },
  { id: "music", icon: Music, label: "rail.music" },
  { id: "effects", icon: SlidersHorizontal, label: "rail.effects" },
  { id: "fx", icon: Sparkles, label: "rail.fx" },
  { id: "trans", icon: TransitionsIcon, label: "rail.trans" },
  { id: "anim", icon: Wand2, label: "rail.anim" },
  { id: "audio", icon: AudioWaveform, label: "rail.audio", adv: true },
  { id: "color", icon: ThreeCirclesIcon, label: "rail.color", adv: true },
  { id: "text", icon: Type, label: "rail.text" },
  { id: "stickers", icon: Sticker, label: "rail.stickers" },
  { id: "captions", icon: Captions, label: "rail.captions" },
  { id: "lyrics", icon: MicVocal, label: "rail.lyrics", adv: true },
  { id: "amv", icon: AudioLines, label: "rail.amv", adv: true },
];

/** The reference's vertical rail of round tool buttons; each opens its panel on the right. */
export function Rail() {
  const t = useT();
  const panel = useEditorUi((s) => s.panel);
  return (
    <nav className="rail" aria-label="Tools">
      <button className="rail-btn rail-back" onClick={() => void leaveEditor()} title={t("editor.back")} aria-label={t("editor.back")}>
        <ArrowLeft size={15} strokeWidth={1.75} />
        <span className="rail-label">{t("editor.back")}</span>
      </button>
      {ITEMS.map(({ id, icon: Icon, label, adv }) => (
        <button
          key={id}
          data-panel={id}
          data-adv={adv ? "" : undefined}
          className={`rail-btn${panel === id ? " active" : ""}`}
          aria-pressed={panel === id}
          title={t(label)}
          aria-label={t(label)}
          onClick={() => useEditorUi.setState({ panel: panel === id ? null : id })}
        >
          <Icon size={15} strokeWidth={1.75} />
          <span className="rail-label">{t(label)}</span>
        </button>
      ))}
    </nav>
  );
}
