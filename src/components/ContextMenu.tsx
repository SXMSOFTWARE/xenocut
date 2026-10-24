// Right-click menus in the glass style. One menu at a time, opened with `openMenu`; on touch
// screens the same items come up from a long press (`useLongPress`) as a bottom sheet.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Check, ChevronRight } from "lucide-react";
import { isMobileUi } from "../lib/platform";

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  /** Shown on the right, e.g. "Ctrl+C". */
  hint?: string;
  run?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  submenu?: MenuEntry[];
}
export type MenuEntry = MenuAction | "-" | null | false | undefined;

interface MenuState {
  at: { x: number; y: number } | null;
  title?: string;
  items: MenuEntry[];
}

export const useMenu = create<MenuState>(() => ({ at: null, items: [] }));

export function openMenuAt(x: number, y: number, items: MenuEntry[], title?: string) {
  const clean = tidy(items);
  if (!clean.length) return;
  useMenu.setState({ at: { x, y }, items: clean, title });
}

/** Opens a menu at the pointer of a contextmenu / long-press event. */
export function openMenu(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuEntry[], title?: string) {
  e.preventDefault?.();
  e.stopPropagation?.();
  openMenuAt(e.clientX, e.clientY, items, title);
}

export const closeMenu = () => useMenu.setState({ at: null, items: [] });

/** Drops empty entries, leading / trailing / doubled separators. */
function tidy(items: MenuEntry[]): (MenuAction | "-")[] {
  const out: (MenuAction | "-")[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item === "-") {
      if (out.length && out[out.length - 1] !== "-") out.push("-");
    } else out.push(item);
  }
  while (out[out.length - 1] === "-") out.pop();
  return out;
}

const LONG_PRESS_MS = 480;

/**
 * Touch long press -> `onMenu(point)`. Spread the returned handlers on the element. A move
 * beyond a few pixels (scroll, drag) cancels. Mouse right-click is handled by `onContextMenu`.
 */
export function useLongPress(onMenu: (p: { clientX: number; clientY: number }) => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };
  useEffect(() => cancel, []);
  return {
    onPointerDownCapture: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      cancel();
      fired.current = false;
      const p = { clientX: e.clientX, clientY: e.clientY };
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        fired.current = true;
        navigator.vibrate?.(12);
        onMenu(p);
      }, LONG_PRESS_MS);
    },
    onPointerMoveCapture: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel();
    },
    onPointerUpCapture: cancel,
    // The click that ends a long press must not also play / select underneath the menu.
    onClickCapture: (e: React.MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
    onPointerCancelCapture: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      // Android fires contextmenu on long press too; the timer already opened the menu.
      if (isMobileUi) e.preventDefault();
      else onMenu(e);
      e.preventDefault();
    },
  };
}

/** Mounted once at the app root. */
export function ContextMenuHost() {
  const { at, items, title } = useMenu();
  // Release builds: no WebView "Reload / Inspect" menu on surfaces without one of ours; text
  // fields keep the native copy/paste menu.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const block = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", block);
    return () => window.removeEventListener("contextmenu", block);
  }, []);
  if (!at) return null;
  return <MenuLayer at={at} items={items} title={title} />;
}

function MenuLayer({ at, items, title }: { at: { x: number; y: number }; items: MenuEntry[]; title?: string }) {
  useEffect(() => {
    const close = () => closeMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, []);
  return (
    <div
      className={`ctx-layer${isMobileUi ? " sheet" : ""}`}
      onPointerDown={(e) => e.target === e.currentTarget && closeMenu()}
      onContextMenu={(e) => {
        e.preventDefault();
        if (e.target === e.currentTarget) closeMenu();
      }}
    >
      <MenuList items={items} at={at} title={title} root />
    </div>
  );
}

function MenuList({ items, at, title, root, parent }: { items: MenuEntry[]; at: { x: number; y: number }; title?: string; root?: boolean; parent?: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [sub, setSub] = useState<{ index: number; rect: DOMRect } | null>(null);
  const [active, setActive] = useState(-1);
  const list = tidy(items);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || (isMobileUi && root)) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = at.x;
    let top = at.y;
    if (parent) {
      left = parent.right - 4;
      top = parent.top - 6;
      if (left + w > vw - 6) left = parent.left - w + 4;
    } else if (left + w > vw - 6) left = Math.max(6, left - w);
    if (top + h > vh - 6) top = Math.max(6, vh - 6 - h);
    setPos({ left: Math.max(6, left), top: Math.max(6, top) });
  }, [at.x, at.y, parent, root]);

  // Arrow keys move through the root menu, Enter runs, → opens a submenu.
  useEffect(() => {
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      const enabled = list.map((it, i) => (it !== "-" && !it.disabled ? i : -1)).filter((i) => i >= 0);
      if (!enabled.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const k = enabled.indexOf(active);
        const next = e.key === "ArrowDown" ? enabled[(k + 1) % enabled.length] : enabled[(k - 1 + enabled.length) % enabled.length];
        setActive(next);
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const it = list[active];
        if (it !== "-" && it.run && !it.submenu) {
          closeMenu();
          it.run();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [root, list, active]);

  const style = isMobileUi && root ? undefined : pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 };
  return (
    <>
      <div className={`ctx-menu${root ? "" : " ctx-sub"}`} ref={ref} style={style} role="menu" onContextMenu={(e) => e.preventDefault()}>
        {title && <div className="ctx-title">{title}</div>}
        {list.map((item, i) =>
          item === "-" ? (
            <div key={`s${i}`} className="ctx-sep" role="separator" />
          ) : (
            <button
              key={`${item.label}-${i}`}
              role="menuitem"
              className={`ctx-item${item.danger ? " danger" : ""}${active === i || sub?.index === i ? " active" : ""}`}
              disabled={item.disabled}
              onPointerEnter={(e) => {
                setActive(i);
                if (item.submenu && !item.disabled) setSub({ index: i, rect: e.currentTarget.getBoundingClientRect() });
                else setSub(null);
              }}
              onClick={(e) => {
                if (item.submenu) {
                  setSub(sub?.index === i ? null : { index: i, rect: e.currentTarget.getBoundingClientRect() });
                  return;
                }
                closeMenu();
                item.run?.();
              }}
            >
              <span className="ctx-icon">{item.checked ? <Check /> : item.icon}</span>
              <span className="ctx-label">{item.label}</span>
              {item.hint && <span className="ctx-hint">{item.hint}</span>}
              {item.submenu && <ChevronRight className="ctx-more" />}
            </button>
          ),
        )}
      </div>
      {sub && list[sub.index] !== "-" && (list[sub.index] as MenuAction).submenu && (
        <MenuList key={sub.index} items={(list[sub.index] as MenuAction).submenu!} at={at} parent={sub.rect} />
      )}
    </>
  );
}
