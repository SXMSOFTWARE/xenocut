import { useEditorUi } from "../../store/editorUi";
import { useProject } from "../../store/project";

export function MediaDragGhost() {
  const drag = useEditorUi((s) => s.dragMedia);
  const name = useProject((s) => (drag ? s.project?.media.find((m) => m.id === drag.mediaId)?.name : undefined));
  if (!drag || !name) return null;
  return (
    <div className="drag-ghost" style={{ transform: `translate(${drag.x + 12}px, ${drag.y + 10}px)` }}>
      {name}
    </div>
  );
}
