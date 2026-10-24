import { useT } from "../../i18n";
import { MediaBin } from "./MediaBin";

/** The media bin docked beside the preview (Modern layout); the tool panel keeps the other side. */
export function DockBin() {
  const t = useT();
  return (
    <aside className="dock-bin" aria-label={t("rail.media")}>
      <div className="sp-head">
        <h2>{t("rail.media")}</h2>
      </div>
      <div className="sp-body">
        <MediaBin />
      </div>
    </aside>
  );
}
