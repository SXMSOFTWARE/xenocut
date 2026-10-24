import { useEffect, useState } from "react";
import { AudioWaveform, Captions, Clapperboard, Music2, Sparkles, Type, Trash2, Boxes } from "lucide-react";
import { useT, type Key } from "../../i18n";
import { api, isAndroid, openExternal } from "../../lib/backend";
import { bytes, messageOf } from "../../lib/format";
import { CREDITS } from "../../lib/credits";
import { toast } from "../../store/toast";

type WhisperModel = Awaited<ReturnType<typeof api.subtitleModels>>[number];

interface Module {
  id: string;
  icon: typeof Captions;
  name: Key;
  text: Key;
  /** Names from CREDITS. */
  powered: string[];
}

const MODULES: Module[] = [
  { id: "media", icon: Clapperboard, name: "modules.media", text: "modules.mediaText", powered: ["FFmpeg", "x264"] },
  { id: "captions", icon: Captions, name: "modules.captions", text: "modules.captionsText", powered: ["OpenAI Whisper (model)", "Candle"] },
  { id: "stems", icon: Music2, name: "modules.stems", text: "modules.stemsText", powered: ["Ultimate Vocal Remover (MDX-Net model)", "ONNX Runtime / ort"] },
  { id: "beats", icon: AudioWaveform, name: "modules.beats", text: "modules.beatsText", powered: ["RustFFT", "hound"] },
  { id: "text", icon: Type, name: "modules.text", text: "modules.textText", powered: ["Fontsource", "Inter", "Montserrat", "Anton"] },
  { id: "effects", icon: Sparkles, name: "modules.effects", text: "modules.effectsText", powered: ["FFmpeg"] },
];

/** The integrated tools, what powers each one, its license and whether its model is on this device. */
export function ModulesSection({ stemModel }: { stemModel: { installed: boolean; bytes: number } | null }) {
  const t = useT();
  const [whisper, setWhisper] = useState<WhisperModel[] | null>(null);
  const refresh = () => void api.subtitleModels().then(setWhisper).catch(() => setWhisper(null));
  useEffect(refresh, []);

  const removeWhisper = async (size: WhisperModel["size"]) => {
    try {
      await api.subtitleModelDelete(size);
    } catch (e) {
      toast(messageOf(e), "error");
    }
    refresh();
  };

  const status = (id: string) => {
    if (id === "stems") {
      if (isAndroid) return <span className="status-pill">{t("modules.desktopOnly")}</span>;
      return stemModel?.installed ? (
        <span className="status-pill ok">{t("settings.installed")} · {bytes(stemModel.bytes)}</span>
      ) : (
        <span className="status-pill">{t("modules.onFirstUse")}</span>
      );
    }
    if (id === "captions") {
      return (
        <span className="module-models">
          {(whisper ?? []).map((m) => (
            <span key={m.size} className={`status-pill${m.installed ? " ok" : ""}`} title={m.installed ? t("settings.installed") : `${t("settings.notInstalled")} · ${bytes(m.downloadBytes)}`}>
              {m.size}
              {m.installed && (
                <button className="pill-x" onClick={() => void removeWhisper(m.size)} aria-label={`${t("settings.delete")} ${m.size}`} title={t("settings.delete")}>
                  <Trash2 />
                </button>
              )}
            </span>
          ))}
        </span>
      );
    }
    return <span className="status-pill ok">{t("modules.builtIn")}</span>;
  };

  return (
    <section className="settings-group">
      <h2 className="section-title">
        <Boxes /> {t("modules.title")}
      </h2>
      <p className="muted settings-note module-intro">{t("modules.intro")}</p>
      <ul className="module-list">
        {MODULES.map((m) => {
          const credits = m.powered.map((n) => CREDITS.find((c) => c.name === n)).filter((c) => c !== undefined);
          const licenses = [...new Set(credits.flatMap((c) => c.license.split(" / ")))].join(" / ");
          return (
            <li key={m.id} className="module-card" data-module={m.id}>
              <span className="module-icon">
                <m.icon />
              </span>
              <div className="module-body">
                <div className="module-head">
                  <b>{t(m.name)}</b>
                  {status(m.id)}
                </div>
                <span className="muted">{t(m.text)}</span>
                <div className="module-credits">
                  {credits.map((c) => (
                    <button key={c.name} className="module-chip" onClick={() => void openExternal(c.url)} title={c.url}>
                      {c.name.replace(/ \(.*\)$/, "")}
                    </button>
                  ))}
                  <span className="oss-license tnum">{licenses}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="muted settings-note module-note">{t("modules.gplNote")}</p>
    </section>
  );
}
