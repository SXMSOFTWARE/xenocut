// Cuts between back-to-back clips on a video track: a small "+" to add a transition, or the
// transition's span centred on the cut (its width is the duration) with symmetric handles.
import { ArrowRightLeft, Plus, Timer, Trash2, Copy } from "lucide-react";
import { memo, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { openMenu, type MenuEntry } from "../../../components/ContextMenu";
import { engine } from "../../../engine/playback";
import { t as tr, useT } from "../../../i18n";
import { clipDuration, updateClip } from "../../../project/ops";
import type { Clip, Track } from "../../../project/types";
import { useEditorUi } from "../../../store/editorUi";
import { useProject } from "../../../store/project";
import { BUILTIN, DEFAULT_DURATION, MIN_DURATION, cuts, effectiveDuration } from "../../../transitions";
import { applyToAllCuts, applyTransitionDef, maxDuration, removeCutTransition, type Cut } from "../../../transitions/catalog";
import { pickCut, transitionName } from "../TransitionsPanel";
import { TransitionsIcon } from "../icons";

function open(c: Cut) {
  pickCut(c.from.id);
  useEditorUi.setState({ panel: "trans" });
}

function cutMenu(e: { clientX: number; clientY: number }, c: Cut) {
  const t = c.from.transition;
  const items: MenuEntry[] = t
    ? [
        { label: tr("trans.change"), icon: <ArrowRightLeft />, run: () => open(c) },
        {
          label: tr("trans.duration"),
          icon: <Timer />,
          submenu: [0.3, 0.5, 0.8, 1, 1.5, 2]
            .filter((d) => d <= maxDuration(c) + 1e-6)
            .map((d) => ({ label: `${d} s`, checked: Math.abs(t.duration - d) < 1e-3, run: () => useProject.getState().commit((p) => updateClip(p, c.from.id, { transition: { ...t, duration: d } })) })),
        },
        { label: tr("trans.applyAll"), icon: <Copy />, run: () => applyToAllCuts(t) },
        "-",
        { label: tr("trans.remove"), icon: <Trash2 />, danger: true, run: () => removeCutTransition(c.from.id) },
      ]
    : [
        { label: tr("trans.add"), icon: <Plus />, run: () => void applyTransitionDef(BUILTIN.get("fade")!, c).then(() => pickCut(c.from.id)) },
        { label: tr("trans.change"), icon: <ArrowRightLeft />, run: () => open(c) },
      ];
  openMenu(e, items, t ? transitionName(tr, t.id, t.name) : tr("trans.title"));
}

function dragDuration(e: ReactPointerEvent, c: Cut, side: -1 | 1, pps: number) {
  e.stopPropagation();
  e.preventDefault();
  const t = c.from.transition;
  if (!t) return;
  const x0 = e.clientX;
  const d0 = effectiveDuration(t.duration, clipDuration(c.from), clipDuration(c.to));
  const max = maxDuration(c);
  const store = useProject.getState();
  store.beginGesture();
  const move = (ev: PointerEvent) => {
    const dx = ((ev.clientX - x0) / pps) * side;
    const d = Math.round(Math.max(MIN_DURATION, Math.min(max, d0 + 2 * dx)) * 100) / 100;
    store.transient((p) => updateClip(p, c.from.id, { transition: { ...t, duration: d } }));
    engine.seek(c.cut);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    store.endGesture();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

export const CutMarks = memo(function CutMarks({ track, clips, pps }: { track: Track; clips: Clip[]; pps: number }) {
  const t = useT();
  const picked = useEditorUi((s) => s.cut);
  const selection = useProject((s) => s.selection);
  const list = useMemo(() => cuts(clips, [track]), [clips, track]);
  if (track.locked) return null;
  return (
    <>
      {list.map((c) => {
        const tn = c.from.transition;
        const active = (selection.length === 0 && picked === c.from.id) || (selection.length === 1 && (selection[0] === c.from.id || selection[0] === c.to.id) && !!tn);
        const stop = (e: ReactPointerEvent) => e.stopPropagation();
        if (!tn) {
          return (
            <button
              key={c.from.id}
              className={`tl-cut${active ? " active" : ""}`}
              data-cut={c.from.id}
              style={{ transform: `translateX(${c.cut * pps}px)` }}
              onPointerDown={stop}
              onClick={() => open(c)}
              onContextMenu={(e) => cutMenu(e, c)}
              title={t("trans.add")}
              aria-label={t("trans.add")}
            >
              <Plus size={10} strokeWidth={2.4} />
            </button>
          );
        }
        const d = effectiveDuration(tn.duration || DEFAULT_DURATION, clipDuration(c.from), clipDuration(c.to));
        const w = Math.max(16, d * pps);
        return (
          <div
            key={c.from.id}
            className={`tl-trans${active ? " active" : ""}`}
            data-cut={c.from.id}
            style={{ transform: `translateX(${c.cut * pps - w / 2}px)`, width: w }}
            onPointerDown={(e) => {
              stop(e);
              if (e.button === 0) open(c);
            }}
            onContextMenu={(e) => cutMenu(e, c)}
            title={`${transitionName(t, tn.id, tn.name)} · ${d.toFixed(2)} s`}
          >
            <span className="tl-trans-ico">
              <TransitionsIcon size={11} />
            </span>
            {active && (
              <>
                <i className="tl-trans-h start" onPointerDown={(e) => dragDuration(e, c, -1, pps)} />
                <i className="tl-trans-h end" onPointerDown={(e) => dragDuration(e, c, 1, pps)} />
              </>
            )}
          </div>
        );
      })}
    </>
  );
});
