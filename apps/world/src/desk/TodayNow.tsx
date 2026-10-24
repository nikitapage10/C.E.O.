import { useState, type ReactNode } from "react";
import { CREW, type Change, type Crate } from "../foundry.ts";
import { useWorldClock, clockState } from "../worldClock.ts";
import { DESK_ROOMS, type DeskAction, type DeskRoom, type OwedReply } from "./deskData.ts";
import { EmailAct } from "./email/EmailAct.tsx";
import { ideaTitle, type Setup } from "./IdeaCard.tsx";
import { roomLink } from "./hero/roomLink.ts";
import { Private } from "./Private.tsx";
import { words, type RoomPulse } from "./roomPulse.ts";
import { SetupAct } from "./SetupCard.tsx";
import type { SetupStatus } from "./setupList.ts";
import { Icon, type TodayIcon } from "./todayIcons.tsx";
import { age, DecisionAct, IdeasAct, QuestionAct, ReplyAct } from "./TodayActs.tsx";
import { useNow } from "./motion.tsx";
import { mtTime, until, upcoming } from "./todaySchedule.ts";

/**
 * Right now (#363, Nikita 2026-10-24: "the focus is what do I need to know right now?"): the top of Today, one list in
 * the order to read it. First what's on fire (a room whose submind says it needs a look, an hour of Ilyr overdue), then
 * what needs an answer from Nikita (Rivet's questions, the Foundry's decisions, replies, email, ideas to pick, setup),
 * then one line of what landed while he was away. Each row has its icon in its room's colour; a row that takes an
 * answer opens its card in place, a row about a room walks into it. When nothing needs him, it says so, and what runs
 * next. Real data only.
 */

type Tier = "fire" | "ask" | "fyi";

interface Row {
  key: string;
  tier: Tier;
  icon: TodayIcon;
  room: DeskRoom;
  /** Small capitals above the line: who or what. */
  label: string;
  title: ReactNode;
  sub?: ReactNode;
  at?: number;
  /** A room to walk into, for a row with no card. */
  href?: string;
  /** The card that answers it, opened in place. */
  card?: () => ReactNode;
}

const personal = (room: DeskRoom) => room === "relay" || room === "spire" || room === "exchange" || room === "boiler";
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What's on fire, from the rooms' own pulses and the world clock: plain facts, no guessing. */
export function fires(pulses: RoomPulse[], clock: "ok" | "slow" | "down" | "off"): { key: string; room: DeskRoom; title: string; sub: string; href: string }[] {
  const out = pulses.filter((p) => p.state === "down").map((p) => ({ key: `down-${p.id}`, room: p.id as DeskRoom, title: `${p.name}: ${p.status}`, sub: p.report, href: p.href }));
  // A stalled clock already shows as a link down in the Boiler Room; an hour only overdue is said here on its own.
  if (clock === "slow") out.push({ key: "clock", room: "boiler", title: "An hour of Ilyr is overdue", sub: "The world clock's step is late. The Boiler Room's gauge has the detail.", href: "/boiler" });
  return out;
}

export interface NowInput {
  now: number;
  pulses: RoomPulse[];
  questions: Crate[];
  decisions: DeskAction[];
  replies: OwedReply[];
  emailNeeds: number;
  toPick: Crate[];
  setup: Setup;
  setupStatus: SetupStatus | null;
  setupLeft: number;
  setupTotal: number;
  /** What shipped since Nikita was last here, newest first. */
  shipped: Change[];
  awaySince: number;
}

export function TodayNow(p: NowInput) {
  const { now } = p;
  const reading = useWorldClock((s) => s.reading);
  const status = useWorldClock((s) => s.status);
  const [open, setOpen] = useState<string | null>(null);

  const rows: Row[] = [
    ...fires(p.pulses, clockState(reading, status, now)).map<Row>((f) => ({ ...f, tier: "fire", icon: "alert", label: `${DESK_ROOMS[f.room].name}, needs a look` })),
    ...p.questions.map<Row>((c) => ({
      key: `q${c.number}`,
      tier: "ask",
      icon: "ask",
      room: "foundry",
      label: "Rivet asks",
      title: `“${c.question}”`,
      sub: `About ${ideaTitle(c.title)}`,
      at: c.updatedAt,
      card: () => <QuestionAct crate={c} setup={p.setup} now={now} />,
    })),
    ...p.decisions.map<Row>((a) => ({
      key: a.id,
      tier: "ask",
      icon: "decide",
      room: a.room,
      label: `${DESK_ROOMS[a.room].name}, a decision`,
      title: personal(a.room) ? <Private>{a.title}</Private> : a.title,
      sub: `${a.agent} suggests “${a.choices[0] ?? "a look"}”`,
      card: () => <DecisionAct a={a} />,
    })),
    ...p.replies.map<Row>((o) => ({
      key: o.id,
      tier: "ask",
      icon: "reply",
      room: "relay",
      label: `A reply, ${o.channel}`,
      title: (
        <>
          <Private>{o.name}</Private> is waiting on you
        </>
      ),
      sub: o.draft ? "Blasto has a draft ready" : undefined,
      at: o.since,
      card: () => <ReplyAct o={o} now={now} />,
    })),
    ...(p.emailNeeds
      ? [{ key: "email", tier: "ask", icon: "mail", room: "relay", label: "Email, sorted by Dialtone", title: `${n(p.emailNeeds, "email needs", "emails need")} you`, sub: "Subjects stay in the Relay.", card: () => <EmailAct count={p.emailNeeds} /> } satisfies Row]
      : []),
    ...(p.toPick.length
      ? [
          {
            key: "ideas",
            tier: "ask",
            icon: "idea",
            room: "foundry",
            label: "The Foundry, ideas",
            title: `${cap(words(p.toPick.length))} ${p.toPick.length === 1 ? "idea waits" : "ideas wait"} for your pick`,
            sub: p.toPick
              .slice(0, 2)
              .map((c) => ideaTitle(c.title))
              .join(", ") + (p.toPick.length > 2 ? `, and ${p.toPick.length - 2} more` : ""),
            card: () => <IdeasAct ideas={p.toPick} setup={p.setup} now={now} />,
          } satisfies Row,
        ]
      : []),
    ...(p.setupLeft
      ? [
          {
            key: "setup",
            tier: "ask",
            icon: "setup",
            room: "boiler",
            label: "Setup, only you can do",
            title: `${n(p.setupLeft, "setup step")} left`,
            sub: `${p.setupTotal - p.setupLeft} of ${p.setupTotal} done`,
            card: () => <SetupAct status={p.setupStatus} />,
          } satisfies Row,
        ]
      : []),
    ...(p.shipped.length
      ? [
          {
            key: "shipped",
            tier: "fyi",
            icon: "shipped",
            room: "foundry",
            label: `Since ${mtTime(p.awaySince)}`,
            title: `${cap(words(p.shipped.length))} shipped while you were away`,
            sub: p.shipped
              .slice(0, 2)
              .map((c) => `${c.by ? CREW[c.by].name : "The crew"}: ${ideaTitle(c.title)}`)
              .join(" · "),
            at: p.shipped[0]!.at,
            href: "/foundry",
          } satisfies Row,
        ]
      : []),
  ];

  const fire = rows.filter((r) => r.tier === "fire").length;
  const ask = rows.filter((r) => r.tier === "ask").length;
  const head =
    fire && ask
      ? `${cap(words(fire))} ${fire === 1 ? "thing needs" : "things need"} a look, and ${words(ask)} ${ask === 1 ? "needs" : "need"} you.`
      : fire
        ? `${cap(words(fire))} ${fire === 1 ? "thing needs" : "things need"} a look.`
        : ask
          ? `${cap(words(ask))} ${ask === 1 ? "thing needs" : "things need"} you.`
          : "Nothing needs you right now.";
  const busy = p.pulses.filter((x) => x.state === "busy").map((x) => x.name);

  return (
    <section className={`td-now${fire ? " has-fire" : ask ? " has-ask" : " is-clear"}`} aria-labelledby="td-now-h" data-in>
      <header className="td-now-head">
        <p className="wv-eyb">
          <i className="td-live" aria-hidden="true" />
          Right now
          <span className="td-now-as">as of {mtTime(now)}</span>
        </p>
        <h2 id="td-now-h" className="td-h2">
          {head}
        </h2>
      </header>
      {fire + ask === 0 && (
        <div className="td-clear" role="status">
          <span className="td-clear-ic">
            <Icon name="clear" />
          </span>
          <p>
            <b>Nothing's on fire either.</b>
            <span>
              {busy.length ? `${busy.join(" and ")} ${busy.length === 1 ? "is" : "are"} working on ${busy.length === 1 ? "its" : "their"} own. ` : "The rooms are quiet. "}
              <NextLine />
            </span>
          </p>
        </div>
      )}
      {rows.length > 0 && (
        <ol className="td-now-l">
          {rows.map((r, i) => {
            const isOpen = open === r.key;
            const inner = (
              <>
                <span className="td-ni-ic">
                  <Icon name={r.icon} />
                </span>
                <span className="td-ni-t">
                  <em>{r.label}</em>
                  <b>{r.title}</b>
                  {r.sub && <span>{r.sub}</span>}
                </span>
                <span className="td-ni-end">
                  {r.at ? <time dateTime={new Date(r.at).toISOString()}>{age(r.at, now)}</time> : null}
                  <span className="td-ni-go">
                    {r.card ? (isOpen ? "Fold" : "Answer") : "Open"}
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d={r.card ? "m4 6 4 4 4-4" : "M6 4l4 4-4 4"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </span>
              </>
            );
            return (
              <li key={r.key} className={`td-ni is-${r.tier}${isOpen ? " is-open" : ""}`} data-room={r.room} style={{ "--i": i } as React.CSSProperties}>
                {r.card ? (
                  <button type="button" className="td-ni-row" aria-expanded={isOpen} aria-controls={`td-ni-${r.key}`} onClick={() => setOpen(isOpen ? null : r.key)}>
                    {inner}
                  </button>
                ) : (
                  <a className="td-ni-row" href={r.href} onClick={roomLink(r.href ?? "/")}>
                    {inner}
                  </a>
                )}
                {r.card && (
                  <div id={`td-ni-${r.key}`} className="td-ni-card" hidden={!isOpen}>
                    {isOpen && r.card()}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** The soonest run, on the rail's own clock so the two always agree. */
function NextLine() {
  const now = useNow(1000);
  const hourAt = useWorldClock((s) => (s.reading?.nextAt ? Date.parse(s.reading.nextAt) : null));
  const next = upcoming(now, hourAt !== null && Number.isFinite(hourAt) ? hourAt : null)[0];
  return next ? <>Next on the schedule: {next.what.toLowerCase()}, {until(next.at, now)}.</> : null;
}
