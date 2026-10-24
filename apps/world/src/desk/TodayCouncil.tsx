import { useEffect, useRef, useState } from "react";
import type { RoomId } from "../chronicle.ts";
import { portrait } from "./deskData.ts";
import { roomLink } from "./hero/roomLink.ts";
import { Private } from "./Private.tsx";
import type { PulseState, RoomPulse } from "./roomPulse.ts";
import { useDeskAuth } from "./signin.ts";
import { handedName, useAsked, whenAsked, type AskedRoom } from "./skippy/asked.ts";
import { useSkippy } from "./skippy/chat.ts";
import { SKIPPY_PORTRAIT } from "./skippy/index.ts";
import { FEED_ROOMS, useRoomFeed, type FeedRoom } from "./skippy/roomFeed.ts";
import { reducedMotion } from "./wvCanvas.ts";

/**
 * The Council of Skippies, on the page (#363; set as the minutes of a sitting since #385, like a script: the speaker in
 * the margin, the line in the big serif, and the stage directions in italics, Nikita 2026-10-24: "I still like the council of Skippies, just they need
 * to be presented in a better way"; it was a pop-up until #351). Skippy calls the room to order and each submind whose
 * room runs real work reports in turn, in its own voice, its words coming in as it speaks: rooms that need a look
 * first, then the busy ones, then the steady and the waiting. The subminds whose rooms aren't set up yet sit along the
 * end of the table; tap one and it says so itself. Pointing at a report lights its strand in the picture above
 * (`onHot`). The meeting plays once, the first time it scrolls into view; with reduced motion it is all there at once.
 * Reports are roomPulse.ts's, from real data.
 *
 * The talks (Nikita, 2026-10-24 03:03Z: "any kind of conversations should be part of the Council of Skippy that I can
 * learn more about if I've had engagement with subminds directly"): the room pages no longer carry "Asked Skippy" or
 * "From the <submind>"; each submind here says whether Nikita has talked with it and opens to read the exchanges, what
 * he asked Skippy that was filed under its room (and the submind's answer to a hand-off, #312/#341), and what it posted
 * from its own thread (#281). Signed in only for the words, every one under <Private> for Hide; signed out, the public
 * view shows how many posts there are and nothing more.
 */

const ASKED_ROOMS: readonly AskedRoom[] = ["green", "exchange", "boiler", "foundry", "relay"];
const asAsked = (r: RoomId): AskedRoom | null => (ASKED_ROOMS as readonly string[]).includes(r) ? (r as AskedRoom) : null;
const asFeed = (r: RoomId): FeedRoom | null => (FEED_ROOMS as readonly string[]).includes(r) ? (r as FeedRoom) : null;
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** Reads the talks once the Desk knows who is looking, again after each answer from Skippy and on sign-in or out. */
function useTalks() {
  const auth = useDeskAuth((s) => s.auth.status);
  const answered = useSkippy((s) => s.turns.length);
  const refreshAsked = useAsked((s) => s.refresh);
  const refreshFeed = useRoomFeed((s) => s.refresh);
  useEffect(() => {
    if (auth === "checking") return;
    for (const r of ASKED_ROOMS) void refreshAsked(r);
    void refreshFeed();
  }, [auth, answered, refreshAsked, refreshFeed]);
  return auth;
}

/** One submind's talks with Nikita: a line saying whether there have been any, and the exchanges under it. */
function Talks({ room, who }: { room: RoomId; who: string }) {
  const auth = useDeskAuth((s) => s.auth.status);
  const ar = asAsked(room);
  const fr = asFeed(room);
  const view = useAsked((s) => (ar ? s.rooms[ar] : undefined));
  const feedStatus = useRoomFeed((s) => s.status);
  const full = useRoomFeed((s) => s.full);
  const events = useRoomFeed((s) => s.events).filter((e) => e.room === fr);
  const [open, setOpen] = useState(false);
  if (!ar && !fr) return null;
  const turns = view?.status === "live" ? view.turns : [];
  const askedOff = !ar || !view || view.status === "off";
  const feedOff = !fr || feedStatus === "off" || feedStatus === "idle";
  if (askedOff && feedOff) return null;
  const signedIn = auth === "in";
  const posts = feedOff ? 0 : events.length;
  const talked = turns.length;
  const line = signedIn
    ? talked || posts
      ? [talked ? `You've talked ${talked === 1 ? "once" : `${talked} times`}` : "You haven't talked yet", posts ? plural(posts, "post") + " from its thread" : ""].filter(Boolean).join(" · ")
      : `You haven't talked with ${who} yet`
    : posts
      ? `${plural(posts, "post")} from its thread. Sign in to read them, and your talks.`
      : "Sign in to see your talks.";
  const canOpen = signedIn && (talked > 0 || posts > 0);
  const id = `td-talk-${room}`;
  return (
    <div className={`td-talks${talked ? " has-talked" : ""}`}>
      {canOpen ? (
        <button type="button" className="td-talks-bar" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          <i className="td-talks-dot" aria-hidden="true" />
          <span>{line}</span>
          <em>{open ? "Fold" : "Read"}</em>
        </button>
      ) : (
        <p className="td-talks-bar is-quiet">
          <i className="td-talks-dot" aria-hidden="true" />
          <span>{line}</span>
        </p>
      )}
      {canOpen && open && (
        <ol id={id} className="td-talks-l">
          {turns.map((t) => (
            <li key={`a${t.at}|${t.question}`}>
              <p className="td-tk-q">
                <b>You asked</b> <Private>{t.question}</Private>
              </p>
              <p className="td-tk-a">
                <b>Skippy</b> <Private>{t.answer}</Private>
              </p>
              {t.followUp && (
                <p className="td-tk-a is-sub">
                  <b>{handedName(t.followUp.from)}</b> <Private>{t.followUp.card ? `${t.followUp.card.verdict} ${t.followUp.text}` : t.followUp.text}</Private>
                </p>
              )}
              <time dateTime={t.at}>{whenAsked(t.at, Date.now())}</time>
            </li>
          ))}
          {events.map((e) => (
            <li key={`f${e.id}`} className="is-post">
              <p className="td-tk-a">
                <b>{who}</b> <Private>{e.title}</Private>
              </p>
              {full && e.detail && (
                <p className="td-tk-d">
                  <Private>{e.detail}</Private>
                </p>
              )}
              <time dateTime={e.at}>{whenAsked(e.at, Date.now())}</time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const STATE_WORD: Record<PulseState, string> = { busy: "Busy", steady: "Steady", waiting: "Waiting", down: "Needs a look", sim: "Not set up" };
const ORDER: Record<PulseState, number> = { down: 0, busy: 1, steady: 2, waiting: 3, sim: 4 };
/** How long each submind takes, between one starting and the next. */
const TURN_MS = 520;
/** Each word's step as a line comes in. */
const WORD_MS = 34;

export function TodayCouncil({ pulses, hot, onHot }: { pulses: RoomPulse[]; hot: string | null; onHot: (id: string | null) => void }) {
  const ref = useRef<HTMLElement>(null);
  const [live, setLive] = useState(() => reducedMotion() || typeof IntersectionObserver === "undefined");
  const [heard, setHeard] = useState<string | null>(null);
  useTalks();
  useEffect(() => {
    if (live) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setLive(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -18% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [live]);

  const speakers = pulses.filter((p) => p.state !== "sim").sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  const bench = pulses.filter((p) => p.state === "sim");
  const active = pulses.filter((p) => p.submind.active).length;
  const heardP = bench.find((p) => p.id === heard) ?? null;
  // Each speaker starts when the one before has had its say: a turn, plus a little for a long report.
  let t = 420;
  const starts = speakers.map((p) => {
    const s = t;
    t += TURN_MS + Math.min(900, p.report.split(/\s+/).length * WORD_MS * 0.6);
    return s;
  });

  return (
    <section ref={ref} className={`td-council${live ? " is-live" : ""}`} aria-labelledby="td-council-h" data-in>
      <header className="td-cn-head">
        <p className="td-k">
          <span>The Council of Skippies</span> in session
        </p>
        <h2 id="td-council-h" className="td-h2">
          Skippy and his nine, reporting in
        </h2>
      </header>

      <ol className="td-cn-l">
        <li className="td-cn is-chair" data-room="kernel" style={{ "--d": "0ms", "--i": 0 } as React.CSSProperties}>
          <span className="td-cn-who">
            <span className="td-cn-pf is-active">
              <img src={SKIPPY_PORTRAIT} alt="" width={48} height={48} decoding="async" loading="lazy" />
            </span>
            <b>Skippy</b>
            <span>the chair</span>
          </span>
          <div className="td-cn-line">
            <span className="td-cn-say">“Council's in session. Report, and keep it short.”</span>
            <span className="td-cn-dir">
              {active} of {pulses.length} subminds are active, each with its own thread; {speakers.length} {speakers.length === 1 ? "room has" : "rooms have"} something real to say.
            </span>
          </div>
        </li>
        {speakers.map((p, i) => {
          const src = portrait(p.submind.id) ?? `/desk/agent-${p.submind.id}.webp`;
          const words = p.report.split(/(\s+)/);
          return (
            <li
              key={p.id}
              data-room={p.id}
              className={`td-cn is-${p.state}${hot === p.id ? " is-hot" : hot ? " is-dim" : ""}`}
              style={{ "--d": `${starts[i]}ms`, "--i": i + 1 } as React.CSSProperties}
              onPointerEnter={() => onHot(p.id)}
              onPointerLeave={() => onHot(null)}
            >
              <a className="td-cn-who" href={p.href} onClick={roomLink(p.href)} onFocus={() => onHot(p.id)} onBlur={() => onHot(null)}>
                <span className={`td-cn-pf${p.submind.active ? " is-active" : ""}`}>
                  <img src={src} alt="" width={48} height={48} decoding="async" loading="lazy" />
                </span>
                <b>{p.submind.title}</b>
                <span>
                  {p.name}, <em>{STATE_WORD[p.state].toLowerCase()}</em>
                </span>
                {p.submind.active && <small title="Its room has a real API, and the submind its own thread">Active</small>}
              </a>
              <div className="td-cn-line">
                <span className="td-cn-say">
                  <i className="td-cn-talk" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </i>
                  {words.map((w, k) =>
                    /^\s+$/.test(w) ? (
                      w
                    ) : (
                      <span key={k} style={{ "--w": `${Math.floor(k / 2) * WORD_MS}ms` } as React.CSSProperties}>
                        {w}
                      </span>
                    ),
                  )}
                </span>
                <Talks room={p.id} who={p.submind.title} />
              </div>
            </li>
          );
        })}
        {bench.length > 0 && (
          <li className="td-cn is-bench" style={{ "--d": `${t}ms`, "--i": speakers.length + 1 } as React.CSSProperties}>
            <span className="td-cn-who">
              <b>Not yet seated</b>
              <span>{bench.length === 1 ? "one room isn't" : `${bench.length} rooms aren't`} set up</span>
            </span>
            <div className="td-cn-line">
              <span className="td-cn-dir">At the end of the table, waiting for their rooms. Tap one to hear it say so.</span>
              <div className="td-cn-bench">
                {bench.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-room={p.id}
                    aria-pressed={heard === p.id}
                    onClick={() => setHeard(heard === p.id ? null : p.id)}
                    onPointerEnter={() => onHot(p.id)}
                    onPointerLeave={() => onHot(null)}
                    aria-label={`${p.submind.title}, ${p.name}`}
                  >
                    <img src={portrait(p.submind.id) ?? `/desk/agent-${p.submind.id}.webp`} alt="" width={36} height={36} decoding="async" loading="lazy" />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
              {heardP && (
                <div key={heardP.id} className="td-cn-heard" data-room={heardP.id}>
                  <span className="td-cn-say" role="status">
                    <b>{heardP.submind.title}:</b> {heardP.report}
                  </span>
                  <Talks room={heardP.id} who={heardP.submind.title} />
                </div>
              )}
            </div>
          </li>
        )}
      </ol>
    </section>
  );
}
