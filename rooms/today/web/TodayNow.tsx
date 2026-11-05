import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { whenLabel } from "../../../api/_today/parse.ts";
import { CREW, crewFor, type Change, type Crate } from "../../../apps/world/src/foundry.ts";
import { useWorldClock, clockState } from "../../../apps/world/src/worldClock.ts";
import { DESK_ROOMS, type DeskAction, type DeskRoom, type OwedReply } from "@ceo/desk/deskData.ts";
import { EmailAct } from "../../relay/web/EmailAct.tsx";
import { ideaTitle, type Setup } from "@ceo/desk/IdeaCard.tsx";
import { roomLink } from "@ceo/desk/hero/roomLink.ts";
import { Private } from "@ceo/engine/web/Private.tsx";
import { words, type RoomPulse } from "@ceo/desk/roomPulse.ts";
import { SetupAct } from "@ceo/desk/SetupCard.tsx";
import type { SetupStatus } from "@ceo/desk/setupList.ts";
import { Icon, type TodayIcon } from "./todayIcons.tsx";
import { age, DecisionAct, DecisionChoices, IdeasAct, QuestionAct, ReplyAct } from "./TodayActs.tsx";
import { KIND_COLOUR, KIND_LABEL, rites, type RiteInput, type RiteItem, type RiteKind } from "@ceo/desk/rotunda/rite.ts";
import { KindIcon } from "@ceo/desk/rotunda/KindIcon.tsx";
import { isSaid, splitArchived, useSenateMemory, versionOf } from "@ceo/desk/rotunda/heard.ts";
import { useNow } from "@ceo/engine/sigils/motion.tsx";
import { mtTime, roman, until, upcoming } from "../data/todaySchedule.ts";
import { HANDED_LINE, handedState, type FloorItem } from "../../../api/_today/floor.ts";
import { useHanded } from "@ceo/desk/todos/floorTalk.ts";
import { TalkBack, TodoCapture, TodoCard, useTodosOn } from "@ceo/desk/todos/TodoBits.tsx";
import { awayRefs, openTodos, useTodos, type Target } from "@ceo/desk/todos/todos.ts";

/**
 * Right now (#363, Nikita 2026-10-24: "the focus is what do I need to know right now?"), "Held for you" in the top right
 * of Today since #413, each row a signal numbered in the chart's numerals, its room lit on the stage while pointed at: one list in
 * the order to read it. First what's on fire (a room whose submind says it needs a look, an hour of Ilyr overdue), then
 * what needs an answer from Nikita (Rivet's questions, the Foundry's decisions, replies, email, ideas to pick, setup),
 * then one line of what landed while he was away. Each row has its icon in its room's colour; a row that takes an
 * answer opens its card in place, a row about a room walks into it. When nothing needs him, it says so, and what runs
 * next. Real data only.
 *
 * Nikita's own to-dos sit in the same list (#622), added from the capture line under the heading, and every row can be
 * talked back to: its mic, or a held Space on it, then a few words ("snooze till tomorrow", "remind me Friday",
 * "note: …", "done", "make it a to-do"). A reminder that has come due rises to the top.
 */

type Tier = "fire" | "ask" | "fyi";

interface Row {
  key: string;
  tier: Tier;
  icon: TodayIcon;
  room: DeskRoom | "today";
  /** Small capitals above the line: who or what. */
  label: string;
  title: ReactNode;
  sub?: ReactNode;
  at?: number;
  /** A room to walk into, for a row with no card. */
  href?: string;
  /** The card that answers it, opened in place. */
  card?: () => ReactNode;
  /** The row in plain words, for a to-do made from it (#622). */
  plain?: string;
  /** What a talk-back to it changes: one of Nikita's to-dos, or the held row by its key. */
  talk?: Target;
  /** A reminder on it has come due: it rises to the top. */
  due?: boolean;
  /** How it plays on the Senate floor (#740): its kind and its ritual's safe words. */
  rite?: Omit<RiteInput, "key">;
  /** A decision's options as buttons that answer it in place. */
  options?: () => ReactNode;
}

/** Held this long, Space starts listening; a quick tap is still a tap. */
const HOLD_MS = 280;

const personal = (room: DeskRoom) => room === "relay" || room === "spire" || room === "exchange" || room === "boiler";
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Words safe for the chamber's captions, which anyone at the screen can read: no numbers that could be money, no addresses. */
const safe = (s: string, fallback: string) => (/[\d@$£€]/.test(s) || s.length > 80 ? fallback : s);

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
  /** Lights a row's room on the stage while it is pointed at. */
  onHot?: (room: string | null) => void;
  /** The eyebrow over the list: "Held for you" on Today since #413. */
  label?: string;
  /**
   * The Senate (#740): what needs him is the docket, one card per item along the foot of the chamber, each a
   * duty, a decision or a repair that plays on the floor; his own to-dos sit under the chamber under "still left", with
   * the add line beside them.
   */
  rotunda?: { name: string; bench: string[]; chamber: (c: ChamberLink) => ReactNode };
}

/** What the chamber (Rotunda.tsx) and the docket share: the items, which one is on the floor, and the stamps. */
export interface ChamberLink {
  docket: RiteItem[];
  onFloor: (key: string | null) => void;
  onDone: (key: string) => void;
  /** Set by the chamber: brings an item to the floor. */
  bring: MutableRefObject<((key: string) => void) | null>;
}

export function TodayNow(p: NowInput) {
  const { now } = p;
  const reading = useWorldClock((s) => s.reading);
  const status = useWorldClock((s) => s.status);
  const [open, setOpen] = useState<string | null>(null);
  const [floor, setFloor] = useState<string | null>(null);
  // What the Senate has said and which cards are put away, per viewer (#900, heard.ts).
  const said = useSenateMemory((s) => s.said);
  const archived = useSenateMemory((s) => s.archived);
  const [showAway, setShowAway] = useState(false);
  const bring = useRef<((key: string) => void) | null>(null);
  const todoState = useTodos((s) => s.state);
  const talkOn = useTodosOn();
  const [talk, setTalk] = useState<{ key: string; listen: boolean; holding?: boolean } | null>(null);
  const hold = useRef<{ key: string; timer: number; held: boolean } | null>(null);
  const away = awayRefs(todoState, now);
  const marks = new Map(todoState.marks.map((m) => [m.ref, m]));
  // Items handed to Skippy from the floor (api/_today/floor.ts), and where each hand-off stands.
  const answers = useHanded(todoState.marks.flatMap((m) => (m.handed && !m.done ? [m.handed] : [])));
  const floorItem = (r: Row): FloorItem | undefined =>
    r.rite && r.talk?.type === "held"
      ? { kind: r.rite.kind, room: r.rite.room, by: r.rite.by, what: r.rite.what, ...(r.rite.cause && { cause: r.rite.cause }), ...(r.rite.fix && { fix: r.rite.fix }), ...(r.rite.options?.[0] && { option: r.rite.options[0].label }) }
      : undefined;
  const handedLine = (r: Row) => {
    const turn = marks.get(r.key)?.handed;
    if (!turn) return null;
    const f = answers.get(turn);
    const state = handedState(f);
    return (
      <p className="td-handed" role="status" data-state={state}>
        <b>{HANDED_LINE[state]}</b>
        {f && <Private> · {f.text}</Private>}
      </p>
    );
  };

  const held: Row[] = [
    ...fires(p.pulses, clockState(reading, status, now)).map<Row>((f) => ({
      ...f,
      tier: "fire",
      icon: "alert",
      label: `${DESK_ROOMS[f.room].name}, needs a look`,
      plain: f.title,
      rite:
        f.key === "clock"
          ? { kind: "repair", by: "boiler", room: "Boiler Room", what: "an hour of Ilyr is overdue", cause: "the world clock's step is late", fix: "read the gauge in the Boiler Room" }
          : { kind: "repair", by: f.room, room: DESK_ROOMS[f.room].name, what: `${DESK_ROOMS[f.room].name} needs a look`, cause: safe(f.title.replace(/^[^:]+:\s*/, ""), "its link isn't answering"), fix: `open ${DESK_ROOMS[f.room].name} and see what it says` },
    })),
    ...p.questions.map<Row>((c) => ({
      key: `q${c.number}`,
      tier: "ask",
      icon: "ask",
      room: "foundry",
      label: "Rivet asks",
      title: `“${c.question}”`,
      sub: `About ${ideaTitle(c.title)}`,
      plain: `Answer Rivet: ${c.question}`,
      at: c.updatedAt,
      card: () => <QuestionAct crate={c} setup={p.setup} now={now} />,
      rite: { kind: "decision", by: "foundry", room: "Foundry", what: `Rivet asks about ${ideaTitle(c.title)}`, options: [{ label: "Reply in words", say: "Rivet asked; an answer settles it." }, { label: "Build as is", say: "Skip the question and build it as written." }, { label: "Not this one" }] },
    })),
    ...p.decisions.map<Row>((a) => ({
      key: a.id,
      tier: "ask",
      icon: "decide",
      room: a.room,
      label: `${DESK_ROOMS[a.room].name}, a decision`,
      title: personal(a.room) ? <Private>{a.title}</Private> : a.title,
      sub: `${a.agent} suggests “${a.choices[0] ?? "a look"}”`,
      plain: a.title,
      card: () => <DecisionAct a={a} />,
      options: () => <DecisionChoices a={a} />,
      rite: {
        kind: "decision",
        by: a.room,
        room: DESK_ROOMS[a.room].name,
        what: personal(a.room) ? `a ${a.kind === "check" ? "quick check" : "decision"} from ${DESK_ROOMS[a.room].name}` : a.title.charAt(0).toLowerCase() + a.title.slice(1),
        options: a.choices.map((c, k) => ({ label: safe(c, `Option ${k + 1}`), say: k === 0 ? `${a.agent} suggests it.` : undefined })),
      },
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
      plain: `Reply to ${o.name}`,
      at: o.since,
      card: () => <ReplyAct o={o} now={now} />,
      // Its wait grows by the minute; it is new news only when a draft turns up (#900).
      rite: { kind: "duty", by: "relay", room: "Relay", what: `a reply on ${o.channel} waiting on you`, say: `It has waited ${age(o.since, now)}.${o.draft ? " Blasto has a draft ready." : ""} Nothing to debate; it only needs you.`, ver: o.draft ? "draft" : "waiting" },
    })),
    ...(p.emailNeeds
      ? [{ key: "email", tier: "ask", icon: "mail", room: "relay", label: "Email, sorted by Dialtone", title: `${n(p.emailNeeds, "email needs", "emails need")} you`, sub: "Subjects stay in the Relay.", plain: "Go through the email that needs me", card: () => <EmailAct count={p.emailNeeds} />, rite: { kind: "duty", by: "relay", room: "Relay", what: `${n(p.emailNeeds, "email")} sorted as needing you`, say: "Dialtone sorted them. The subjects stay in Relay." } } satisfies Row]
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
            plain: "Pick the Foundry's ideas",
            sub: p.toPick
              .slice(0, 2)
              .map((c) => ideaTitle(c.title))
              .join(", ") + (p.toPick.length > 2 ? `, and ${p.toPick.length - 2} more` : ""),
            card: () => <IdeasAct ideas={p.toPick} setup={p.setup} now={now} />,
            rite: {
              kind: "decision",
              by: "foundry",
              room: "Foundry",
              what: "which idea the Foundry builds next",
              options: p.toPick.slice(0, 3).map((c) => ({ label: ideaTitle(c.title), say: c.pitch ? c.pitch.split(/(?<=\.)\s/)[0] : `For ${CREW[c.builder ?? crewFor(c)].name}${c.size ? `, ${c.size}` : ""}.` })),
            },
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
            plain: "Finish the Desk's setup steps",
            card: () => <SetupAct status={p.setupStatus} />,
            rite: { kind: "duty", by: "boiler", room: "Boiler Room", what: `${n(p.setupLeft, "setup step")} only you can do`, say: `${p.setupTotal - p.setupLeft} of ${p.setupTotal} done. The rest need your hands.` },
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
            rite: { kind: "duty", by: "foundry", room: "Foundry", what: `${words(p.shipped.length)} ${p.shipped.length === 1 ? "change" : "changes"} shipped while you were away`, say: `Shipped: ${p.shipped.slice(0, 2).map((c) => ideaTitle(c.title)).join(", ")}${p.shipped.length > 2 ? ", and more" : ""}.` },
          } satisfies Row,
        ]
      : []),
  ];

  // What Nikita said back to the held rows (#622): put away for now, a note, a reminder.
  const system = held
    .filter((r) => !away.has(r.key))
    .map<Row>((r) => {
      const m = marks.get(r.key);
      if (!m || r.tier === "fyi") return { ...r, talk: r.tier === "fyi" ? undefined : { type: "held", ref: r.key, text: r.plain ?? "" } };
      const remind = m.remind ? Date.parse(m.remind) : NaN;
      const note = m.notes?.at(-1);
      return {
        ...r,
        talk: { type: "held", ref: r.key, text: r.plain ?? "" },
        due: remind <= now,
        icon: remind <= now ? "bell" : r.icon,
        label: remind <= now ? `Reminder · ${r.label}` : Number.isFinite(remind) ? `${r.label} · reminder ${whenLabel(remind, now)}` : r.label,
        sub: note ? <Private>Note: {note}</Private> : r.sub,
      };
    });
  const mine = openTodos(todoState, now).map<Row>((t) => {
    const due = t.due ? Date.parse(t.due) : NaN;
    const isDue = due <= now;
    const note = t.notes?.at(-1);
    return {
      key: `todo:${t.id}`,
      tier: "ask",
      icon: isDue ? "bell" : "todo",
      room: "today",
      label: isDue ? `Your to-do · due ${whenLabel(due, now)}` : Number.isFinite(due) ? `Your to-do · ${whenLabel(due, now)}` : "Your to-do",
      title: <Private>{t.text}</Private>,
      sub: note ? <Private>Note: {note}</Private> : undefined,
      at: Date.parse(t.at),
      card: () => <TodoCard todo={t} />,
      talk: { type: "todo", id: t.id },
      due: isDue,
    };
  });
  // Due reminders first, then what's on fire, then what needs an answer (Nikita's own after the rooms'), then the FYI.
  const rows: Row[] = [
    ...[...system, ...mine].filter((r) => r.due),
    ...system.filter((r) => !r.due && r.tier === "fire"),
    ...system.filter((r) => !r.due && r.tier === "ask"),
    ...mine.filter((r) => !r.due),
    ...system.filter((r) => r.tier === "fyi"),
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

  // A held Space on a row (#622): listening while it is held, the words go when it is let go. A quick tap is a tap.
  const spaceDown = (r: Row, e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== " " || !talkOn || !r.talk) return;
    e.preventDefault();
    if (e.repeat || hold.current) return;
    const key = r.key;
    hold.current = {
      key,
      held: false,
      timer: window.setTimeout(() => {
        if (hold.current?.key !== key) return;
        hold.current.held = true;
        setTalk({ key, listen: true, holding: true });
      }, HOLD_MS),
    };
  };
  const spaceUp = (r: Row, e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== " " || !hold.current || hold.current.key !== r.key) return;
    e.preventDefault();
    const h = hold.current;
    hold.current = null;
    window.clearTimeout(h.timer);
    if (h.held) setTalk((t) => (t && t.key === r.key ? { ...t, holding: false } : t));
    else if (r.card) setOpen(open === r.key ? null : r.key);
    else (e.currentTarget as HTMLElement).click();
  };

  const row = (r: Row, i: number, numeral: string) => {
    const isOpen = open === r.key;
    const inner = (
      <>
        <span className="td-ni-n" aria-hidden="true">
          {numeral}
        </span>
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
      <li
        key={r.key}
        className={`td-ni is-${r.tier}${isOpen ? " is-open" : ""}${r.due ? " is-due" : ""}${r.room === "today" ? " is-mine" : ""}`}
        data-room={r.room}
        style={{ "--i": i } as React.CSSProperties}
        onPointerEnter={() => p.onHot?.(r.room === "today" ? null : r.room)}
        onPointerLeave={() => p.onHot?.(null)}
      >
        <div className="td-ni-line">
          {r.card ? (
            <button type="button" className="td-ni-row" aria-expanded={isOpen} aria-controls={`td-ni-${r.key}`} onClick={() => setOpen(isOpen ? null : r.key)} onKeyDown={(e) => spaceDown(r, e)} onKeyUp={(e) => spaceUp(r, e)}>
              {inner}
            </button>
          ) : (
            <a className="td-ni-row" href={r.href} onClick={roomLink(r.href ?? "/")} onKeyDown={(e) => spaceDown(r, e)} onKeyUp={(e) => spaceUp(r, e)}>
              {inner}
            </a>
          )}
          {talkOn && r.talk && (
            <button
              type="button"
              className={`td-ni-talk${talk?.key === r.key ? " is-on" : ""}`}
              aria-label="Talk back to this: snooze, remind, note, done or to-do"
              title="Talk back: snooze, remind, note, done (or hold Space on the row)"
              aria-expanded={talk?.key === r.key}
              onClick={() => setTalk(talk?.key === r.key ? null : { key: r.key, listen: true })}
            >
              <Icon name="mic" />
            </button>
          )}
        </div>
        {handedLine(r)}
        {talk?.key === r.key && r.talk && <TalkBack key={r.key} target={r.talk} item={floorItem(r)} listen={talk.listen} holding={talk.holding} onClose={() => setTalk(null)} />}
        {r.card && (
          <div id={`td-ni-${r.key}`} className="td-ni-card" hidden={!isOpen}>
            {isOpen && r.card()}
          </div>
        )}
      </li>
    );
  };

  // The Senate's docket (#740): every row that needs him, each with its ritual, numbered in the list's order.
  const need = rows.filter((r) => r.room !== "today");
  const inputOf = (r: Row): RiteInput => ({ key: r.key, ...(r.rite ?? { kind: "duty", by: "kernel", room: "Senate", what: "something for you" }) });
  // Each row's content version (#900): a card put away stays away until what it says changes.
  const vers = new Map(need.map((r) => [r.key, versionOf(inputOf(r))]));
  const verOf = (r: Row) => vers.get(r.key) ?? "";
  const memory = { said, archived, recess: 0 };
  const { shown, away: putAwayRows } = splitArchived(need, (r) => r.key, verOf, memory);
  const inputs: RiteInput[] = shown.map(inputOf);
  const bench = p.rotunda?.bench ?? [];
  const sig = JSON.stringify([inputs, bench]);
  // Keyed on the content, so the chamber gets a new docket only when it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const docket = useMemo(() => rites(inputs, bench), [sig]);

  if (p.rotunda) {
    const R = p.rotunda;
    const left = rows.filter((r) => r.room === "today");
    const onFloor = docket.find((d) => d.key === floor) ?? null;
    const count = shown.length;
    const putAway = (r: Row) => {
      if (open === r.key) setOpen(null);
      if (talk?.key === r.key) setTalk(null);
      useSenateMemory.getState().archive_(r.key, verOf(r));
    };
    const title = count ? (
      <>
        {cap(words(count))} {count === 1 ? "item" : "items"} <i>before you,</i> {R.name}.
      </>
    ) : (
      <>
        Nothing <i>before you,</i> {R.name}.
      </>
    );
    const card = (r: Row, i: number) => {
      const it = docket[i];
      const kind: RiteKind = it?.kind ?? "duty";
      const isOpen = open === r.key;
      const toggle = () => setOpen(isOpen ? null : r.key);
      const roomName = r.room === "today" ? "Senate" : DESK_ROOMS[r.room].name;
      const primary = r.card ? (
        <button type="button" className="rt-act is-p" aria-expanded={isOpen} aria-controls={`td-ni-${r.key}`} onClick={toggle}>
          {isOpen ? "Fold" : kind === "decision" ? "Details" : "Answer"}
        </button>
      ) : (
        <a className="rt-act is-p" href={r.href} onClick={roomLink(r.href ?? "/")}>
          {kind === "repair" ? `Open ${roomName}` : "Open"}
        </a>
      );
      const acts =
        kind === "decision" ? (
          r.options ? (
            <>
              {r.options()}
              {primary}
            </>
          ) : (
            (it?.options ?? []).map((o, k) => (
              <button key={o.label} type="button" className={`rt-act is-opt${k === 0 ? " is-pick" : ""}`} aria-expanded={isOpen} aria-controls={`td-ni-${r.key}`} onClick={() => setOpen(r.key)}>
                {o.label}
              </button>
            ))
          )
        ) : (
          primary
        );
      // Got it (#900): off the docket and never read out; it waits under Archived.
      const done = (
        <button type="button" className="rt-act is-x" aria-label={`Got it: put away item ${it?.n ?? i + 1}`} title="Got it: put this card away (it waits under Archived)" onClick={() => putAway(r)}>
          Got it
        </button>
      );
      return (
        <li
          key={r.key}
          className={`td-ni rt-mo is-${kind} is-${r.tier}${isOpen ? " is-open" : ""}${floor === r.key ? " is-on" : ""}${isSaid(memory, r.key, verOf(r)) ? " is-stamped" : ""}${r.due ? " is-due" : ""}`}
          data-room={r.room}
          style={{ "--i": i, "--tc": KIND_COLOUR[kind] } as React.CSSProperties}
          onPointerEnter={() => p.onHot?.(r.room === "today" ? null : r.room)}
          onPointerLeave={() => p.onHot?.(null)}
        >
          <div className="td-ni-line">
            <button type="button" className="td-ni-row rt-mo-main" title="Bring it to the floor" onClick={() => bring.current?.(r.key)} onKeyDown={(e) => spaceDown(r, e)} onKeyUp={(e) => spaceUp(r, e)}>
              <span className="rt-mo-k">
                <span className="rt-mo-ty">
                  <KindIcon kind={kind} />
                  {KIND_LABEL[kind]}
                </span>
                <span>
                  Item {it?.n ?? i + 1} · {it?.room ?? roomName}
                </span>
              </span>
              <span className="td-ni-t">
                <em>{r.label}</em>
                <b>{r.title}</b>
                {r.sub && <span>{r.sub}</span>}
              </span>
              <span className="rt-mo-m">
                {it?.meta}
                {r.at ? <time dateTime={new Date(r.at).toISOString()}> · {age(r.at, now)}</time> : null}
              </span>
            </button>
            <span className="rt-stamp" aria-hidden="true">
              {it?.stamp}
            </span>
            {talkOn && r.talk && (
              <button
                type="button"
                className={`td-ni-talk${talk?.key === r.key ? " is-on" : ""}`}
                aria-label="Talk back to this: go ahead, ask Skippy, snooze, remind, note or done"
                title="Talk back: “go ahead” hands it to Skippy; or ask, snooze, note, done (or hold Space on the card)"
                aria-expanded={talk?.key === r.key}
                onClick={() => setTalk(talk?.key === r.key ? null : { key: r.key, listen: true })}
              >
                <Icon name="mic" />
              </button>
            )}
          </div>
          <div className="rt-acts">
            {acts}
            {done}
          </div>
          {handedLine(r)}
          {talk?.key === r.key && r.talk && (
            <div className="rt-talk">
              <TalkBack key={r.key} target={r.talk} item={floorItem(r)} listen={talk.listen} holding={talk.holding} onClose={() => setTalk(null)} />
            </div>
          )}
          {r.card && (
            <div id={`td-ni-${r.key}`} className="td-ni-card rt-floor" hidden={!isOpen}>
              {isOpen && (
                <>
                  <div className="rt-floor-bar">
                    <span>
                      Item {it?.n ?? i + 1} · {it ? KIND_LABEL[it.kind] : "Duty"}
                    </span>
                    <button type="button" className="rt-floor-x" onClick={() => setOpen(null)}>
                      Fold
                    </button>
                  </div>
                  {r.card()}
                </>
              )}
            </div>
          )}
        </li>
      );
    };
    return (
      <section className={`td-now is-rotunda${fire ? " has-fire" : ask ? " has-ask" : " is-clear"}`} aria-labelledby="td-now-h" data-in>
        <div className="rt-hall">
          <header className="rt-hd">
            <p className="rt-date">
              The Senate · {new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
              <span> · the Council is in session</span>
            </p>
            <h1 id="td-now-h" className="desk__title rt-h1">
              {title}
            </h1>
          </header>
          <p className="rt-order" aria-hidden="true">
            <span>Order of business</span>
            <b>
              {onFloor ? (
                <>
                  <span style={{ color: KIND_COLOUR[onFloor.kind] }}>
                    <KindIcon kind={onFloor.kind} />
                  </span>
                  Item {onFloor.n} · {KIND_LABEL[onFloor.kind]}
                </>
              ) : (
                "–"
              )}
            </b>
          </p>
          {R.chamber({
            docket,
            onFloor: setFloor,
            // Said: its card takes its stamp, and the Senate won't read it out again (#900).
            onDone: (key) => {
              const it = docket.find((d) => d.key === key);
              if (it) useSenateMemory.getState().said_(key, it.ver);
            },
            bring,
          })}
          <div className="rt-dock">
            {putAwayRows.length > 0 && (
              <div className="rt-away">
                <button type="button" className="rt-away-t" aria-expanded={showAway} aria-controls="rt-away-l" onClick={() => setShowAway(!showAway)}>
                  Archived ({putAwayRows.length})
                </button>
                {showAway && (
                  <ol id="rt-away-l" className="rt-away-l" aria-label="Archived">
                    {putAwayRows.map((r) => (
                      <li key={r.key}>
                        <span className="rt-away-x">
                          <em>{r.label}</em>
                          <b>{r.title}</b>
                        </span>
                        {r.href && (
                          <a className="rt-act" href={r.href} onClick={roomLink(r.href)}>
                            Open
                          </a>
                        )}
                        <button type="button" className="rt-act" onClick={() => useSenateMemory.getState().restore_(r.key)}>
                          Restore
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
            {shown.length > 0 ? (
              <ol className="td-now-l rt-docket" aria-label="Held for you">
                {shown.map((r, i) => card(r, i))}
              </ol>
            ) : (
              <p className="ti-clear rt-clear" role="status">
                {busy.length ? `${busy.join(" and ")} ${busy.length === 1 ? "is" : "are"} working on ${busy.length === 1 ? "its" : "their"} own. ` : "The rooms are quiet. "}
                <NextLine />
              </p>
            )}
          </div>
        </div>
        <div className="rt-below">
          <div className="rt-left">
            <p className="ti-left-k">
              <span>still left</span>
            </p>
            {left.length > 0 && <ol className="td-now-l ti-left">{left.map((r, i) => row(r, shown.length + i, "○"))}</ol>}
            <TodoCapture />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`td-now${fire ? " has-fire" : ask ? " has-ask" : " is-clear"}`} aria-labelledby="td-now-h" data-in>
      <header className="td-now-head">
        <p className="wv-eyb">
          <i className="td-live" aria-hidden="true" />
          <span>{p.label ?? "Right now"}</span>
          <span className="td-now-as">{mtTime(now)}</span>
        </p>
        <h2 id="td-now-h" className="td-h2">
          {head}
        </h2>
        <TodoCapture />
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
      {rows.length > 0 && <ol className="td-now-l">{rows.map((r, i) => row(r, i, roman(i + 1).toLowerCase()))}</ol>}
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
