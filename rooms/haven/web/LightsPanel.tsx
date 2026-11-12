import { useEffect, useRef, useState } from "react";
import { downNote, type Light, type LightsView } from "./lights.ts";

/**
 * The Lights panel (#931, #974, #1002), under the Haven's lists. Plain by default (#1002, Nikita: "overly
 * complicated"): the Rooms (SwitchBot's switches, each a room's own lights) and the Lamps (Govee's lights) as one tap
 * each, then the Scenes row (SwitchBot's one-tap scenes and the projector's infrared power). "Edit" opens the rest:
 * a Govee light's colour, white, brightness and moods behind "Colour", Place (or Move once it's on the map: tap it,
 * then its spot on the house; the spot goes in the private plan), and the apps' groups ("Same-Model": on or off,
 * never placed). The lights Nikita doesn't use never reach it (lights.ts HIDDEN_LIGHTS). Passkey only; it shows
 * nothing until the lights' keys are set.
 */

export type Look = { rgb: string } | { kelvin: number } | { brightness: number } | { mood: string };

/** Colours one tap away: the two whites first, then the ones the house's lamps glow in. */
const SWATCHES: { name: string; css: string; look: (l: Light) => Look }[] = [
  { name: "Warm white", css: "#ffd29a", look: (l) => (l.look?.kelvin ? { kelvin: Math.max(l.look.kelvin[0], 2700) } : { rgb: "#ffd29a" }) },
  { name: "White", css: "#fff4e5", look: (l) => (l.look?.kelvin ? { kelvin: Math.min(l.look.kelvin[1], 4500) } : { rgb: "#fff4e5" }) },
  { name: "Green", css: "#39ff7a", look: () => ({ rgb: "#39ff7a" }) },
  { name: "Amber", css: "#ff9a3a", look: () => ({ rgb: "#ff9a3a" }) },
  { name: "Red", css: "#ff3030", look: () => ({ rgb: "#ff3030" }) },
  { name: "Violet", css: "#8a5bff", look: () => ({ rgb: "#8a5bff" }) },
  { name: "Blue", css: "#3a7bff", look: () => ({ rgb: "#3a7bff" }) },
];

export interface LightsPanelProps {
  view: LightsView;
  /** Ids of the lights that are on the house. */
  placed: ReadonlySet<string>;
  /** The light being placed, by id. */
  placing: string | null;
  /** Placing a run (#1007): the first tap is where it starts, the second where it ends; null for a single spot. */
  placingStep?: "start" | "end" | null;
  /** Placing is possible (the house is drawn). */
  canPlace: boolean;
  busy: string | null;
  note: string | null;
  onSet: (id: string, on: boolean) => void;
  onScene: (id: string) => void;
  onLook: (id: string, look: Look) => void;
  onPlace: (id: string | null) => void;
  /** Whether the panel is on screen (#1077): the Haven reads Govee's lamps faster only then. */
  onSeen?: (seen: boolean) => void;
}

export function LightsPanel({ view, placed, placing, placingStep = null, canPlace, busy, note, onSet, onScene, onLook, onPlace, onSeen }: LightsPanelProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const box = useRef<HTMLElement | null>(null);
  const seen = useRef(onSeen);
  seen.current = onSeen;
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => seen.current?.(es.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => {
      io.disconnect();
      seen.current?.(false);
    };
  }, []);
  const groups = view.groups ?? [];
  const down = downNote(view);
  if (!view.lights.length && !view.scenes.length && !groups.length && !view.remotes.length && !down) return null;
  // #1077: a lamp whose vendor isn't answering stays listed, unreachable.
  const word = (l: Light) => (l.stale ? "unreachable" : !l.online ? "offline" : l.on === null ? "state unknown" : l.on ? "on" : "off");
  const lamps = view.lights.filter((l) => l.vendor === "govee");
  const rooms = view.lights.filter((l) => l.vendor === "switchbot");
  // Placing goes on while the panel is closed only by the house; keep its row's Cancel in reach.
  const editing = edit || placing !== null;
  const placingName = placing ? view.lights.find((l) => l.id === placing)?.name : null;
  const pow = (id: string) => (
    <>
      <button type="button" className="hv-lt-pow" disabled={busy !== null} onClick={() => onSet(id, true)}>
        On
      </button>
      <button type="button" className="hv-lt-pow" disabled={busy !== null} onClick={() => onSet(id, false)}>
        Off
      </button>
    </>
  );

  const row = (l: Light) => {
    const look = editing && l.look && (l.look.color || l.look.brightness || l.look.kelvin || l.look.moods.length) ? l.look : null;
    const shown = open === l.id && look;
    return (
      <li key={l.id} className="hv-lt-item" data-placing={placing === l.id ? "" : undefined}>
        <div className="hv-lt-line">
          <button type="button" className="hv-lt" data-on={!l.online ? "offline" : l.on === null ? "unknown" : l.on ? "on" : "off"} style={l.rgb ? { ["--hv-lt-c" as string]: l.rgb } : undefined} aria-pressed={l.on === true} disabled={busy !== null || !l.online} onClick={() => onSet(l.id, l.on !== true)} aria-label={`${l.name}, ${word(l)}. Turn ${l.on === true ? "off" : "on"}.`}>
            <i aria-hidden="true" />
            <span>{l.name}</span>
          </button>
          {look && (
            <button type="button" className="hv-lt-mini" aria-expanded={!!shown} aria-label={`${l.name}: colour and mood`} onClick={() => setOpen(shown ? null : l.id)}>
              Colour
            </button>
          )}
          {editing && <button type="button" className="hv-lt-mini" aria-pressed={placing === l.id} disabled={!canPlace} aria-label={placing === l.id ? `Stop placing ${l.name}` : `${placed.has(l.id) ? "Move" : "Place"} ${l.name} on the house`} onClick={() => onPlace(placing === l.id ? null : l.id)}>
            {placing === l.id ? "Cancel" : placed.has(l.id) ? "Move" : "Place"}
          </button>}
        </div>
        {shown && (
          <div className="hv-lt-look" role="group" aria-label={`${l.name}: colour and mood`}>
            {(look.color || look.kelvin) && (
              <div className="hv-lt-sw">
                {SWATCHES.filter((s) => look.color || /white/i.test(s.name)).map((s) => (
                  <button key={s.name} type="button" title={s.name} aria-label={`${l.name}: ${s.name}`} disabled={busy !== null} style={{ background: s.css }} onClick={() => onLook(l.id, s.look(l))} />
                ))}
                {look.color && <input type="color" className="hv-lt-pick" title="Any colour" aria-label={`${l.name}: any colour`} defaultValue={l.rgb ?? "#ffd29a"} disabled={busy !== null} onChange={(e) => onLook(l.id, { rgb: e.currentTarget.value.toLowerCase() })} />}
              </div>
            )}
            {look.brightness && (
              <label className="hv-lt-dim">
                <span>Brightness</span>
                <input type="range" min={1} max={100} defaultValue={l.brightness ?? 100} disabled={busy !== null} aria-label={`${l.name}: brightness`} onPointerUp={(e) => onLook(l.id, { brightness: Number(e.currentTarget.value) })} onKeyUp={(e) => onLook(l.id, { brightness: Number(e.currentTarget.value) })} />
              </label>
            )}
            {look.moods.length > 0 && (
              <select className="hv-lt-mood" aria-label={`${l.name}: mood`} value="" disabled={busy !== null} onChange={(e) => e.currentTarget.value && onLook(l.id, { mood: e.currentTarget.value })}>
                <option value="">Mood…</option>
                {look.moods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section ref={box} className="hv-lights" aria-label="Lights" data-edit={editing ? "" : undefined}>
      <div className="hv-lt-top">
        <h3 className="hv-lt-h">Lights</h3>
        <button type="button" className="hv-lt-mini" aria-pressed={edit} aria-label={edit ? "Done editing the lights" : "Edit the lights: colour, place, groups"} onClick={() => {
            setEdit(!edit);
            setOpen(null);
            if (edit && placing) onPlace(null);
          }}>
          {edit ? "Done" : "Edit"}
        </button>
      </div>
      {placingName && (
        <p className="hv-lt-note is-placing" role="status">
          {placingStep === "start" ? `Tap where ${placingName} starts on the house.` : placingStep === "end" ? `Now tap where ${placingName} ends.` : `Tap where ${placingName} stands on the house.`}
        </p>
      )}
      {rooms.length > 0 && (
        <div className="hv-lt-sec" role="group" aria-label="Rooms">
          <h4 className="hv-lt-sh">Rooms</h4>
          <ul className="hv-lt-list">{rooms.map(row)}</ul>
        </div>
      )}
      {lamps.length > 0 && (
        <div className="hv-lt-sec" role="group" aria-label="Lamps">
          <h4 className="hv-lt-sh">Lamps</h4>
          <ul className="hv-lt-list">{lamps.map(row)}</ul>
        </div>
      )}
      {(view.scenes.length > 0 || view.remotes.length > 0 || (editing && groups.length > 0)) && (
        <div className="hv-lt-sec" role="group" aria-label="Scenes">
          <h4 className="hv-lt-sh">Scenes</h4>
          {view.scenes.length > 0 && (
            <div className="hv-lt-row">
              {view.scenes.map((s) => (
                <button key={s.id} type="button" className="hv-lt-scene" disabled={busy !== null} onClick={() => onScene(s.id)}>
                  {busy === s.id ? "Running…" : s.name}
                </button>
              ))}
            </div>
          )}
          {view.remotes.map((r) => (
            <div key={r.id} className="hv-lt-remote" role="group" aria-label={`${r.name} power`}>
              <span>{r.name}</span>
              {pow(r.id)}
            </div>
          ))}
          {editing &&
            groups.map((g) => (
              <div key={g.id} className="hv-lt-remote" role="group" aria-label={`${g.name}, a group`}>
                <span>{g.name}</span>
                {pow(g.id)}
              </div>
            ))}
        </div>
      )}
      {down && <p className="hv-lt-note">{down}</p>}
      {note && (
        <p className="hv-lt-note" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
