import { useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import type { RoomSection } from "@ceo/engine/web/sections.ts";
import { sectionOf } from "@ceo/engine/web/sections.ts";
import { navigateTo } from "../../world/src/route.ts";

/**
 * A room's tabs as a little fan of icons over its slot in the phone's bar (#1118). Nikita, 2026-11-13: holding the
 * Haven on an iPhone opened the link in a new tab (iOS's own long-press), so a tap now opens this instead: one
 * round icon per tab, rising from the slot, its name under it. A tap on one goes there; a tap anywhere else, or on
 * the slot again, puts it away. Only rooms with tabs (the Haven, the Boiler Room) get one; the rest go straight in.
 */

/** Each tab's icon, drawn on a 24 grid in the bar's line style. One the list lacks gets its first letter. */
const ICONS: Record<string, string> = {
  // The Haven
  house: "M4 11.5 12 5l8 6.5M6.5 10v9h11v-9M10 19v-5h4v5",
  kitchen: "M5 11h14v2a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6zM4 11h16M9 8c0-1.2 1-1.6 1-3M13 8c0-1.2 1-1.6 1-3",
  hall: "M6 19h12M8 19V9a4 4 0 0 1 8 0v10M12 13v2",
  pets: "M8 9.5a1.6 1.9 0 1 0 0 .1M16 9.5a1.6 1.9 0 1 0 0 .1M5 13.5a1.5 1.7 0 1 0 0 .1M19 13.5a1.5 1.7 0 1 0 0 .1M12 13c-2.6 0-4.5 2.4-4.5 4 0 1.4 1.3 2 2.4 2 .9 0 1.4-.4 2.1-.4s1.2.4 2.1.4c1.1 0 2.4-.6 2.4-2 0-1.6-1.9-4-4.5-4z",
  gym: "M3 12h18M6 8.5v7M9 7v10M15 7v10M18 8.5v7",
  // The Boiler Room
  systems: "M5 7h6v4h8M11 11v6h6M5 7v10h6",
  controls: "M6 5v14M12 5v14M18 5v14M4 9h4M10 15h4M16 11h4",
  security: "M12 4 5 7v5c0 4 3 7 7 8 4-1 7-4 7-8V7zM9.5 12l2 2 3.5-4",
  compliance: "M7 4h8l3 3v13H7zM15 4v3h3M10 12h5M10 16h5",
};

/** Each icon's width in the fan, for keeping it on screen. */
const STEP = 62;

export function TabFan({ sections, pathname, accent, x, onClose }: { sections: readonly RoomSection[]; pathname: string; accent: string; x: number; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const inRoom = sections.length > 0 && pathname.split("/")[1] === sections[0]!.path.split("/")[1];
  const current = inRoom ? sectionOf(sections, pathname).id : null;
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Node | null;
      // A tap on the slot that opened it toggles it there; anywhere else puts it away.
      if (t && (box.current?.contains(t) || (t as Element).closest?.(".ph-slot.is-fan"))) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  // Centred over the slot, kept on screen; the little pointer under it still points at the slot (--ax).
  const half = (sections.length * STEP) / 2 + 10;
  const left = Math.min(Math.max(x, half), window.innerWidth - half);
  const go = (path: string) => (e: ReactMouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onClose();
    navigateTo(path + window.location.search);
  };
  return (
    <div className="ph-fan" ref={box} role="menu" aria-label="Tabs" style={{ ["--rc" as string]: accent, ["--ax" as string]: `${Math.round(x - left)}px`, left: `${Math.round(left)}px` } as CSSProperties}>
      {sections.map((s, i) => (
        <a key={s.id} role="menuitem" href={s.path} onClick={go(s.path)} aria-current={current === s.id ? "page" : undefined} style={{ ["--i" as string]: i } as CSSProperties}>
          <i>
            {ICONS[s.id] ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={ICONS[s.id]} />
              </svg>
            ) : (
              <b aria-hidden="true">{s.label.slice(0, 1)}</b>
            )}
          </i>
          <span>{s.label}</span>
        </a>
      ))}
    </div>
  );
}
