import { useEffect, useRef, useState, type FormEvent } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { ACHIEVEMENTS, unlock, useAchievements } from "../achievements/achievements.ts";
import { useCast } from "../cast/castStore.ts";
import { deck, onDeckChange, playTrack, stopTrack } from "../club/deck.ts";
import { COMMANDS, runCommand, type Command } from "../console/commands.ts";
import { sendLetter } from "../letters/LetterFlight.tsx";
import { useLetters } from "../letters/letters.ts";
import { SHIFT_LABEL, formatHour, hourNow, shiftOf } from "../night/dayCycle.ts";
import { VEIL } from "../veil/veil.ts";

/** Which of the C.E.O.'s own panels is open: the Kernel console or the trophy list. */
export const usePanels = create<{ open: "console" | "trophies" | null; toggle: (p: "console" | "trophies") => void; close: () => void }>((set, get) => ({
  open: null,
  toggle: (p) => {
    if (p === "console") unlock("root");
    set({ open: get().open === p ? null : p });
  },
  close: () => set({ open: null }),
}));

/** The Lattice's hour of day and shift, for the top bar. */
export function DayClock() {
  const [hour, setHour] = useState(hourNow);
  useEffect(() => {
    const id = setInterval(() => setHour(hourNow()), 1000);
    return () => clearInterval(id);
  }, []);
  const shift = shiftOf(hour);
  return (
    <span className={`dayclock dayclock--${shift}`} title="Lattice hour of day">
      <i aria-hidden="true" className="dayclock__dot" />
      <span className="tracked">{formatHour(hour)}</span>
      <span className="tracked faint">{SHIFT_LABEL[shift]}</span>
      {VEIL && <span className="tracked dayclock__veil">Hallowed Veil</span>}
    </span>
  );
}

/** Footer control: send a track down to Tomorrowlattice's decks, or stop it. */
export function DeckButton() {
  const input = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    const off = onDeckChange(() => force((n) => n + 1));
    return () => {
      off();
    };
  }, []);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setError(false);
      await playTrack(file);
    } catch {
      setError(true);
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="audio/*"
        hidden
        data-control="track"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {deck.playing ? (
        <button className="tracked deck--on" onClick={stopTrack} title={`Playing "${deck.title}" in the Break Room. Click to stop.`} data-control="decks">
          Decks <b>■ {deck.title.length > 18 ? `${deck.title.slice(0, 17)}…` : deck.title}</b>
        </button>
      ) : (
        <button className="tracked" onClick={() => input.current?.click()} title="Play one of your own tracks at the Break Room club. It plays in this browser only." data-control="decks">
          Decks <b>{error ? "Can't play that" : "Play a track"}</b>
        </button>
      )}
    </>
  );
}

export function PanelButtons() {
  const open = usePanels((s) => s.open);
  const toggle = usePanels((s) => s.toggle);
  const earned = useAchievements((s) => Object.keys(s.unlocked).length);
  return (
    <>
      <button className={`tracked ${open === "console" ? "on" : ""}`} onClick={() => toggle("console")} data-control="console" title="Kernel console · `">
        Console <b>›_</b>
      </button>
      <span className="slash">/</span>
      <button className={`tracked ${open === "trophies" ? "on" : ""}`} onClick={() => toggle("trophies")} data-control="trophies" title="Your achievements">
        Trophies <b>{earned}/{ACHIEVEMENTS.length}</b>
      </button>
    </>
  );
}

interface LogLine {
  id: number;
  who: "you" | "kernel";
  text: string;
}

const GROUP_LABEL: Record<Command["group"], string> = { gather: "Gatherings", cast: "The cast", world: "The Lattice" };

/** The Kernel console: buttons for every command, and a prompt for typing them. */
export function KernelConsole() {
  const open = usePanels((s) => s.open === "console");
  const close = usePanels((s) => s.close);
  const [log, setLog] = useState<LogLine[]>([{ id: 0, who: "kernel", text: "Kernel console. I take orders from the C.E.O. only. Type \"help\", or press a button." }]);
  const [text, setText] = useState("");
  const counter = useRef(1);
  const field = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  useEffect(() => {
    // Braces matter: newer Chrome returns a Promise from scrollIntoView, and React would call it as the cleanup.
    end.current?.scrollIntoView({ block: "nearest" });
  }, [log]);
  if (!open) return null;

  const run = (typed: string) => {
    const answer = runCommand(typed);
    if (!answer) return;
    setLog((l) => [...l, { id: counter.current++, who: "you" as const, text: typed }, { id: counter.current++, who: "kernel" as const, text: answer }].slice(-30));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(text);
    setText("");
  };
  const groups = (["gather", "cast", "world"] as const).map((g) => ({ g, cmds: COMMANDS.filter((c) => c.group === g) }));
  return (
    <section className="console" aria-label="Kernel console">
      <header className="console__head">
        <p className="eyebrow">Kernel console</p>
        <button className="dossier__close" onClick={close} aria-label="Close console">
          ×
        </button>
      </header>
      {groups.map(({ g, cmds }) => (
        <div key={g} className="console__group">
          <p className="tracked faint">{GROUP_LABEL[g]}</p>
          <div className="console__buttons">
            {cmds.map((c) => (
              <button key={c.verb} className="smoky" title={c.about} onClick={() => run(c.verb)} data-command={c.verb}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <ol className="console__log">
        {log.map((l) => (
          <li key={l.id} className={`console__line console__line--${l.who}`}>
            {l.who === "you" ? "› " : ""}
            {l.text}
          </li>
        ))}
        <li ref={end} />
      </ol>
      <form className="console__prompt" onSubmit={submit}>
        <span aria-hidden="true">›</span>
        <input ref={field} value={text} onChange={(e) => setText(e.target.value)} placeholder="help" aria-label="Command" spellCheck={false} autoComplete="off" />
      </form>
    </section>
  );
}

/** The C.E.O.'s achievements, as the Kernel keeps them. Locked ones show a hint. */
export function TrophyPanel() {
  const open = usePanels((s) => s.open === "trophies");
  const close = usePanels((s) => s.close);
  const unlocked = useAchievements((s) => s.unlocked);
  if (!open) return null;
  const earned = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;
  return (
    <section className="console trophies" aria-label="Achievements">
      <header className="console__head">
        <p className="eyebrow">
          Achievements · {earned}/{ACHIEVEMENTS.length}
        </p>
        <button className="dossier__close" onClick={close} aria-label="Close achievements">
          ×
        </button>
      </header>
      <p className="trophies__note">Awarded by the Kernel. Each comes with a loot box, kept in the Archive. Nobody opens them.</p>
      <ul className="trophies__list">
        {ACHIEVEMENTS.map((a) => {
          const got = !!unlocked[a.id];
          return (
            <li key={a.id} className={got ? "trophy trophy--got" : "trophy"}>
              <span className="trophy__title">{got ? a.title : "???"}</span>
              <span className="trophy__line">{got ? a.line : a.hint}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** In a dossier: write to this agent, and read what they wrote back. */
export function LetterBox({ id }: { id: string }) {
  const name = useCast((s) => s.cast.profiles[id]?.name ?? id);
  const letters = useLetters(useShallow((s) => s.letters.filter((l) => l.to === id)));
  const busy = useLetters((s) => s.inFlight !== null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (sendLetter(id, text)) {
      setText("");
      setWriting(false);
    }
  };
  return (
    <div className="dossier__field letters">
      <p className="eyebrow">Letters</p>
      {letters.slice(-3).map((l) => (
        <div key={l.id} className="letter">
          <p className="letter__mine">“{l.text}”</p>
          <p className="letter__reply">{l.reply ? `${name}: ${l.reply}` : "In the post…"}</p>
        </div>
      ))}
      {writing ? (
        <form className="letter__form" onSubmit={send}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={600} rows={3} placeholder={`Dear ${name},`} aria-label={`Letter to ${name}`} autoFocus />
          <div className="letter__actions">
            <button type="button" className="tracked link" onClick={() => setWriting(false)}>
              Cancel
            </button>
            <button type="submit" className="smoky smoky--bright" disabled={busy || !text.trim()}>
              {busy ? "Courier busy" : "Send via the Relay"}
            </button>
          </div>
        </form>
      ) : (
        <button className="tracked link letter__write" onClick={() => setWriting(true)}>
          ✉ Write to {name}
        </button>
      )}
    </div>
  );
}
