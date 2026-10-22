import { useState } from "react";
import { CREW, crewFor, type Crate } from "../foundry.ts";
import { DESK_ROOMS, formatWait, portrait, useDesk, type DeskAction, type DeskRoom, type OwedReply } from "./deskData.ts";
import { ideaTitle, Mic, useIdeaChoice, type Setup } from "./IdeaCard.tsx";
import { link } from "./nav.ts";
import { Private } from "./Private.tsx";
import { DeskSignIn } from "./SignIn.tsx";

/**
 * What needs Nikita on Today, as the approved Weave cards: each card hangs from a thread in its room's colour with a
 * knot where it joins, says who is asking in small capitals, shows their portrait and one serif line, and takes the
 * answer in place. Ideas, Rivet's questions and the Foundry's decisions are real (GitHub); replies come from the hub.
 */

const HOUR = 3_600_000;
/** "5 min", "3 h", "2 d": how long a card has waited. */
export function age(at: number | undefined, now: number): string {
  if (!at) return "";
  const ms = Math.max(0, now - at);
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 24 * HOUR) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / (24 * HOUR))} d`;
}

const Check = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 2.8 6-6.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The line a resolved card settles to, over its faded content. */
function Said({ text }: { text: string }) {
  return (
    <p className="wv-act-said" role="status">
      <Check />
      {text}
    </p>
  );
}

/** Rooms whose asks carry Nikita's own life (messages, money, the house): their wording is veiled under Hide. */
const personal = (room: DeskRoom) => room === "relay" || room === "spire" || room === "exchange" || room === "boiler";

type CardStyle = React.CSSProperties & { "--i"?: number };

/** Rivet's question on an idea: answer in words (typed or said), build it as it is, or pass. */
export function QuestionAct({ crate, setup, now, style }: { crate: Crate; setup: Setup; now: number; style?: CardStyle }) {
  const c = useIdeaChoice(crate, setup);
  const replying = c.mode === "answer" || (c.mode === "busy" && c.note.trim() !== "");
  const resolved = c.mode === "done";
  return (
    <article className={`wv-act${resolved ? " is-said" : ""}`} data-room="foundry" style={style}>
      <div className="wv-act-top">
        <i className="wv-dot" />
        <span>Rivet asks</span>
        <time dateTime={crate.updatedAt ? new Date(crate.updatedAt).toISOString() : undefined}>{age(crate.updatedAt, now)}</time>
      </div>
      <div className="wv-act-body">
        <img className="wv-act-pf" src={portrait("Rivet")!} alt="Rivet" />
        <div>
          <h3 className="wv-h3">“{crate.question}”</h3>
          <p className="wv-act-p">
            About <b>{ideaTitle(crate.title)}</b>
            {crate.pitch ? `. ${crate.pitch}` : "."}
          </p>
        </div>
      </div>
      {c.mode === "signin" ? (
        <div className="wv-act-sign">
          <DeskSignIn compact onDone={c.resume} onCancel={c.cancelSignIn} />
        </div>
      ) : c.mode === "failed" ? (
        <p className="wv-act-note">That didn't go through. Try again in a moment.</p>
      ) : (
        <>
          <div className="wv-act-do">
            <button type="button" className="wv-btn is-pri" disabled={!c.ready || c.mode === "busy"} onClick={() => c.setMode(replying ? "idle" : "answer")} aria-expanded={replying}>
              Reply in words
            </button>
            <button type="button" className="wv-btn" disabled={!c.ready || c.mode === "busy"} onClick={() => void c.go("build")} title="Skip the question and send the idea to the build queue as it is">
              Build as is
            </button>
            <button type="button" className="wv-btn is-ghost" disabled={!c.ready || c.mode === "busy"} onClick={() => void c.go("pass")}>
              Not this one
            </button>
          </div>
          {replying && (
            <form
              className="wv-act-reply"
              onSubmit={(e) => {
                e.preventDefault();
                if (c.note.trim()) void c.go("answer");
              }}
            >
              <input className="wv-input" type="text" value={c.note} onChange={(e) => c.setNote(e.target.value)} placeholder={c.dictation.listening ? "Listening…" : "Tell Rivet what you think"} aria-label="Reply to Rivet" maxLength={2000} autoFocus />
              <Mic dictation={c.dictation} onToggle={c.toggleMic} label="Say your answer" />
              <button type="submit" className="wv-btn is-pri is-sm" disabled={!c.note.trim() || c.mode === "busy"}>
                Send
              </button>
            </form>
          )}
          {c.held && (
            <p className="wv-act-note" role="alert">
              {c.held}
            </p>
          )}
          {!c.ready && setup !== null && <p className="wv-act-note">Answering from here needs the Foundry's setup on Vercel; the Foundry tab says what's missing.</p>}
        </>
      )}
      {resolved && <Said text={c.result} />}
    </article>
  );
}

/** One waiting idea, as a row: who shaped it, its size, and Build or Not this one. */
function IdeaRow({ crate, setup }: { crate: Crate; setup: Setup }) {
  const c = useIdeaChoice(crate, setup);
  const who = crate.builder ?? crewFor(crate);
  const pending = crate.number < 0 || crate.revising;
  return (
    <li className={c.mode === "done" ? "is-set" : undefined}>
      <img className="wv-act-pf is-sm" src={`/desk/agent-${who}.webp`} alt="" />
      <div>
        <b>{ideaTitle(crate.title)}</b>
        <span>
          {pending ? "Rivet is shaping it" : `For ${CREW[who].name}${crate.size ? `, ${crate.size}` : ""}`}
          {crate.number > 0 && (
            <>
              {" · "}
              <a href={crate.url} target="_blank" rel="noreferrer">
                #{crate.number}
              </a>
            </>
          )}
        </span>
      </div>
      {c.mode === "done" ? (
        <p className="wv-act-ok">
          <Check />
          {c.result}
        </p>
      ) : c.mode === "signin" ? (
        <div className="wv-act-sign">
          <DeskSignIn compact onDone={c.resume} onCancel={c.cancelSignIn} />
        </div>
      ) : c.mode === "failed" ? (
        <p className="wv-act-note">That didn't go through. Try again.</p>
      ) : (
        !pending && (
          <span className="wv-act-ib">
            <button type="button" className="wv-btn is-pri is-sm" disabled={!c.ready || c.mode === "busy"} onClick={() => void c.go("build")}>
              Build
            </button>
            <button type="button" className="wv-btn is-sm" disabled={!c.ready || c.mode === "busy"} onClick={() => void c.go("pass")}>
              Not this one
            </button>
          </span>
        )
      )}
    </li>
  );
}

const NUMBER = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
export const inWords = (n: number) => NUMBER[n] ?? String(n);

/** The ideas waiting for a pick, up to three rows; the rest are on the Foundry tab. */
export function IdeasAct({ ideas, setup, now, style }: { ideas: Crate[]; setup: Setup; now: number; style?: CardStyle }) {
  const shown = ideas.slice(0, 3);
  const oldest = Math.min(...ideas.map((c) => c.createdAt ?? c.updatedAt));
  return (
    <article className="wv-act" data-room="foundry" style={style}>
      <div className="wv-act-top">
        <i className="wv-dot" />
        <span>
          {inWords(ideas.length)} {ideas.length === 1 ? "idea" : "ideas"} waiting
        </span>
        <time>{age(oldest, now)}</time>
      </div>
      <ul className="wv-act-ideas">
        {shown.map((c) => (
          <IdeaRow key={c.number} crate={c} setup={setup} />
        ))}
      </ul>
      {ideas.length > shown.length && (
        <a className="wv-link wv-act-link" href="/foundry" onClick={link("foundry")}>
          {ideas.length - shown.length} more, with Revise, on the Foundry tab →
        </a>
      )}
    </article>
  );
}

/** A decision from a room: the Foundry's "ship it?" and "stuck", or the hub's own. */
export function DecisionAct({ a, style }: { a: DeskAction; style?: CardStyle }) {
  const act = useDesk((s) => s.act);
  const [said, setSaid] = useState("");
  const pic = portrait(a.agent);
  const label = a.room === "foundry" ? (a.kind === "check" ? "Foundry, a quick check" : "Foundry, a decision") : `${DESK_ROOMS[a.room].name}, ${a.kind === "check" ? "a quick check" : "a decision"}`;
  return (
    <article className={`wv-act${said ? " is-said" : ""}`} data-room={a.room} style={style}>
      <div className="wv-act-top">
        <i className="wv-dot" />
        <span>{label}</span>
        {a.due && <time>{a.due}</time>}
      </div>
      <div className="wv-act-body">
        {pic ? <img className="wv-act-pf" src={pic} alt={a.agent} /> : <span className="wv-act-pf wv-act-can" aria-hidden="true" />}
        <div>
          <h3 className="wv-h3">{personal(a.room) ? <Private>{a.title}</Private> : a.title}</h3>
          {a.detail && <p className="wv-act-p">{personal(a.room) ? <Private>{a.detail}</Private> : a.detail}</p>}
        </div>
      </div>
      <div className="wv-act-do">
        {a.choices.map((c, k) => {
          const href = a.hrefs?.[k];
          const cls = `wv-btn${k === 0 ? " is-pri" : k > 1 ? " is-ghost" : ""}`;
          return href ? (
            <a key={c} className={cls} href={href} target="_blank" rel="noreferrer">
              {c}
            </a>
          ) : (
            <button
              key={c}
              type="button"
              className={cls}
              onClick={() => {
                setSaid(c);
                window.setTimeout(() => act(a.id), 900);
              }}
            >
              {c}
            </button>
          );
        })}
      </div>
      {said && <Said text={said} />}
    </article>
  );
}

/** A reply someone is waiting on, with Blasto's draft: send it, edit it on Relay, or later. */
export function ReplyAct({ o, now, style }: { o: OwedReply; now: number; style?: CardStyle }) {
  const { send, later, pick } = useDesk();
  return (
    <article className="wv-act" data-room="relay" style={style}>
      <div className="wv-act-top">
        <i className="wv-dot" />
        <span>{o.draft ? "Blasto drafted a reply" : "A reply you owe"}</span>
        <time>{formatWait(now - o.since)}</time>
      </div>
      <div className="wv-act-body">
        <img className="wv-act-pf" src={portrait("Blasto")!} alt="Blasto" />
        <div>
          <h3 className="wv-h3">
            Reply to <Private>{o.name}</Private>
          </h3>
          <p className="wv-act-p">
            <Private>“{o.preview}”</Private>
          </p>
          {o.draft && (
            <p className="wv-act-draft">
              <Private>{o.draft}</Private>
            </p>
          )}
        </div>
      </div>
      <div className="wv-act-do">
        <button type="button" className="wv-btn is-pri" disabled={!o.draft} onClick={() => send(o.id)}>
          Send
        </button>
        <a
          className="wv-btn"
          href="/relay"
          onClick={(e) => {
            pick(o.id);
            link("relay")(e);
          }}
        >
          Edit
        </a>
        <button type="button" className="wv-btn is-ghost" onClick={() => later(o.id)}>
          Later
        </button>
      </div>
    </article>
  );
}

/** What can wait: the rooms' later asks, and any replies past the three on Today. */
export function LaterAct({ items, moreReplies, style }: { items: DeskAction[]; moreReplies: number; style?: CardStyle }) {
  const act = useDesk((s) => s.act);
  return (
    <article className="wv-act" data-room={items[0]?.room ?? "relay"} style={style}>
      <div className="wv-act-top">
        <i className="wv-dot is-faint" />
        <span>Can wait, but not forever</span>
      </div>
      <ul className="wv-act-ideas">
        {items.map((a) => {
          const pic = portrait(a.agent);
          return (
            <li key={a.id}>
              {pic && <img className="wv-act-pf is-sm" src={pic} alt="" />}
              <div>
                <b>{personal(a.room) ? <Private>{a.title}</Private> : a.title}</b>
                <span>
                  {DESK_ROOMS[a.room].name}, {a.agent}
                  {a.due ? ` · ${a.due}` : ""}
                </span>
              </div>
              <span className="wv-act-ib">
                {a.choices.slice(0, 2).map((c, k) => {
                  const href = a.hrefs?.[k];
                  return href ? (
                    <a key={c} className={`wv-btn is-sm${k === 0 ? " is-pri" : ""}`} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
                      {c}
                    </a>
                  ) : (
                    <button key={c} type="button" className={`wv-btn is-sm${k === 0 ? " is-pri" : ""}`} onClick={() => act(a.id)}>
                      {c}
                    </button>
                  );
                })}
              </span>
            </li>
          );
        })}
        {moreReplies > 0 && (
          <li>
            <img className="wv-act-pf is-sm" src={portrait("Blasto")!} alt="" />
            <div>
              <b>
                {moreReplies} more {moreReplies === 1 ? "reply" : "replies"} waiting
              </b>
              <span>Relay, Blasto</span>
            </div>
            <span className="wv-act-ib">
              <a className="wv-btn is-sm" href="/relay" onClick={link("relay")}>
                Open Relay
              </a>
            </span>
          </li>
        )}
      </ul>
    </article>
  );
}
