import type { MouseEvent } from "react";
import type { RoomSection } from "./sections.ts";

/** A section's count beside its name (the Boiler Room Map's tabs, #732): states and counts only, so it reads the same signed out. */
export type SectionScores = Partial<Record<string, { v: string; warn?: boolean }>>;

/**
 * A room's sub-menu (#617, `sections.ts`): one link per section, the current one marked. The engine imports no Desk
 * routes, so the page hands it the current section and how to go to a path (the Desk's `navigateTo`); a plain click
 * goes there in the app, and a modified one opens the address as usual. The look is the room's, by `className`.
 */
export function RoomSections({
  sections,
  current,
  go,
  label,
  scores,
  className = "wv-subnav",
}: {
  sections: readonly RoomSection[];
  current: string;
  go: (path: string) => void;
  label: string;
  scores?: SectionScores;
  className?: string;
}) {
  const open = (path: string) => (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(path);
  };
  return (
    <nav className={className} aria-label={label}>
      {sections.map((s) => {
        const sc = scores?.[s.id];
        return (
          <a key={s.id} href={s.path} title={s.hint} aria-current={current === s.id ? "page" : undefined} onClick={open(s.path)}>
            {s.label}
            {sc ? <b className={sc.warn ? "is-warn" : undefined}>{sc.v}</b> : null}
          </a>
        );
      })}
    </nav>
  );
}
