import { useEffect, useRef, type CSSProperties } from "react";
import { CREW, useFoundry } from "../../foundry.ts";
import { ideaTitle } from "../IdeaCard.tsx";
import { roomLink } from "../hero/roomLink.ts";
import { ROOM_ORDER, type PulseState } from "../roomPulse.ts";
import type { RoomId } from "../../chronicle.ts";
import { useSkippy } from "../skippy/chat.ts";
import { mtTime } from "../todaySchedule.ts";
import { reducedMotion } from "../wvCanvas.ts";
import { COUNCIL_RC as RC } from "./deskPulses.ts";
import { Talks } from "../confluence/Talks.tsx";
import type { CouncilPulse } from "./live.ts";

/**
 * A member of the Council, opened (#666, kept for the Senate in #740): what its room is doing now, the last real thing
 * it did today, what's held for Nikita there, and his talks with it (signed in only for the words, Talks.tsx), with the
 * way into its room. Skippy's own card says what he says and opens his chat (Talk lives there).
 */

const STATE_WORD: Record<PulseState, string> = { busy: "busy", steady: "steady", waiting: "waiting", down: "needs a look", sim: "not set up" };
const MOMENT: Partial<Record<string, string>> = { archive: "An hour of Ilyr written", relay: "Email checked", boiler: "A link checked" };
const job = (title: string) => title.replace(/^The /, "");

export interface MemberCardProps {
  /** A member's id, or "kernel" for Skippy. */
  id: string;
  pulses: CouncilPulse[];
  now: number;
  since: number;
  held: Record<string, number>;
  skippySays: string;
  active: number;
  phone: boolean;
  onClose: () => void;
}

export function MemberCard({ id, pulses, now, since, held, skippySays, active, phone, onClose }: MemberCardProps) {
  const setOpen = useSkippy((s) => s.setOpen);
  const changelog = useFoundry((s) => s.data.changelog);
  const box = useRef<HTMLElement>(null);
  // On a phone the card sits at the foot of the chamber: brought into view clear of Ask Skippy's dock (scroll-margin).
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
    if (phone) box.current?.scrollIntoView?.({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [id, phone]);
  const p = pulses.find((x) => x.id === id) ?? null;
  const close = (
    <button type="button" className="ti-card-x" onClick={onClose} aria-label="Close">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );

  if (!p) {
    return (
      <aside ref={box} tabIndex={-1} className="ti-card" style={{ "--c": "227,201,141" } as CSSProperties} aria-label="Skippy, the Magnificent">
        <header>
          <div>
            <h2>Skippy, the Magnificent</h2>
            <p>The Kernel · presiding</p>
          </div>
          {close}
        </header>
        <p className="ti-card-say">“{skippySays}”</p>
        <p className="ti-card-k">
          {active} of {pulses.length} subminds active, each with its own thread.
        </p>
        <div className="ti-card-acts">
          <button type="button" className="ti-btn" onClick={() => setOpen(true)}>
            Talk to Skippy
          </button>
        </div>
      </aside>
    );
  }

  const last =
    p.id === "foundry"
      ? (() => {
          const c = changelog.filter((x) => x.at >= since && x.at <= now).sort((a, b) => b.at - a.at)[0];
          return c ? { at: c.at, what: `Shipped${c.issue ? ` #${c.issue.number}` : ""} ${ideaTitle(c.title)}${c.by ? ` · ${CREW[c.by].name}` : ""}` } : null;
        })()
      : (() => {
          const t = p.events.filter((x) => x >= since && x <= now).sort((a, b) => b - a)[0];
          return t ? { at: t, what: MOMENT[p.id] ?? "A scene in Ilyr, set here" } : null;
        })();
  const n = held[p.id] ?? 0;

  return (
    <aside ref={box} tabIndex={-1} className="ti-card" data-room={p.id} style={{ "--c": RC[p.id] } as CSSProperties} aria-label={`${p.submind.title}, ${p.name}`}>
      <header>
        <div>
          <h2>{p.submind.title}</h2>
          <p>
            {p.name} · {STATE_WORD[p.state]}
            {p.submind.active ? " · active" : ""}
          </p>
        </div>
        {close}
      </header>
      <dl className="ti-card-l">
        <div>
          <dt>Now</dt>
          <dd>{p.state === "sim" ? "Not set up yet: no real work is connected here." : (p.doing ?? p.status)}</dd>
        </div>
        <div>
          <dt>Last</dt>
          <dd>
            {last ? (
              <>
                <time dateTime={new Date(last.at).toISOString()}>{mtTime(last.at)}</time> {last.what}
              </>
            ) : (
              "Nothing yet today."
            )}
          </dd>
        </div>
        <div>
          <dt>Open</dt>
          <dd>
            {n ? `${n} ${n === 1 ? "thing" : "things"} held for you here` : "Nothing held for you here"} · {p.drive}
          </dd>
        </div>
      </dl>
      {(ROOM_ORDER as readonly string[]).includes(p.id) && <Talks room={p.id as RoomId} who={p.submind.title} />}
      <div className="ti-card-acts">
        <a className="ti-btn" href={p.href} onClick={roomLink(p.href)}>
          Open {p.name} ›
        </a>
        <span className="ti-card-job">{job(p.submind.title)}</span>
      </div>
    </aside>
  );
}
