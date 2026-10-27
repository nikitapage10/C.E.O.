import { useEffect, useState } from "react";
import type { RoomId } from "../../chronicle.ts";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { handedName, useAsked, whenAsked, type AskedRoom } from "../skippy/asked.ts";
import { useSkippy } from "../skippy/chat.ts";
import { FEED_ROOMS, useRoomFeed, type FeedRoom } from "../skippy/roomFeed.ts";

/**
 * The Council's talks (#363, kept on Today's room panel since #413; Nikita 2026-10-24 03:03Z: "any kind of
 * conversations should be part of the Council of Skippy that I can learn more about if I've had engagement with
 * subminds directly"): whether Nikita has talked with a submind, and the exchanges under it: what he asked Skippy that
 * was filed under its room (and the submind's answer to a hand-off, #312/#341), and what it posted from its own thread
 * (#281). Signed in only for the words, every one under <Private> for Hide; signed out, the public view shows how many
 * posts there are and nothing more.
 */

const ASKED_ROOMS: readonly AskedRoom[] = ["green", "exchange", "boiler", "foundry", "relay"];
const asAsked = (r: RoomId): AskedRoom | null => (ASKED_ROOMS as readonly string[]).includes(r) ? (r as AskedRoom) : null;
const asFeed = (r: RoomId): FeedRoom | null => (FEED_ROOMS as readonly string[]).includes(r) ? (r as FeedRoom) : null;
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** Reads the talks once the Desk knows who is looking, again after each answer from Skippy and on sign-in or out. */
export function useTalks() {
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
export function Talks({ room, who, heading = false }: { room: RoomId; who: string; heading?: boolean }) {
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
      {heading && <h3>Your talks</h3>}
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
                <b>{t.via === "voice" ? "You said on the call" : "You asked"}</b> <Private>{t.question}</Private>
              </p>
              <p className={`td-tk-a${t.via === "voice" ? " is-sub" : ""}`}>
                <b>{t.via === "voice" && t.by ? `${handedName(t.by)}, on the mic` : "Skippy"}</b> <Private>{t.answer}</Private>
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
