import type { Light, LightsView } from "./lights.ts";

/**
 * The Lights panel (#931), under the Haven's lists: the SwitchBot scenes as one-tap buttons ("Turn off lights"), each
 * light as a switch with its state, the projector's infrared power as On and Off, and the lights the house couldn't
 * place, so Nikita can say which is which. Passkey only; it shows nothing until the lights' keys are set.
 */
export function LightsPanel({ view, loose, busy, note, onSet, onScene }: { view: LightsView; loose: readonly Light[]; busy: string | null; note: string | null; onSet: (id: string, on: boolean) => void; onScene: (id: string) => void }) {
  const down = (["switchbot", "govee"] as const).filter((v) => view.vendors[v] === "down").map((v) => (v === "govee" ? "Govee" : "SwitchBot"));
  if (!view.lights.length && !view.scenes.length && !view.remotes.length && !down.length) return null;
  const word = (l: Light) => (!l.online ? "offline" : l.on === null ? "state unknown" : l.on ? "on" : "off");
  return (
    <section className="hv-lights" aria-label="Lights">
      <h3 className="hv-lt-h">Lights</h3>
      {view.scenes.length > 0 && (
        <div className="hv-lt-row">
          {view.scenes.map((s) => (
            <button key={s.id} type="button" className="hv-lt-scene" disabled={busy !== null} onClick={() => onScene(s.id)}>
              {busy === s.id ? "Running…" : s.name}
            </button>
          ))}
        </div>
      )}
      {view.lights.length > 0 && (
        <ul className="hv-lt-list">
          {view.lights.map((l) => (
            <li key={l.id}>
              <button type="button" className="hv-lt" data-on={!l.online ? "offline" : l.on === null ? "unknown" : l.on ? "on" : "off"} aria-pressed={l.on === true} disabled={busy !== null || !l.online} onClick={() => onSet(l.id, l.on !== true)} aria-label={`${l.name}, ${word(l)}. Turn ${l.on === true ? "off" : "on"}.`}>
                <i aria-hidden="true" />
                <span>{l.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {view.remotes.map((r) => (
        <div key={r.id} className="hv-lt-remote" role="group" aria-label={`${r.name} power`}>
          <span>{r.name}</span>
          <button type="button" className="hv-lt-pow" disabled={busy !== null} onClick={() => onSet(r.id, true)}>
            On
          </button>
          <button type="button" className="hv-lt-pow" disabled={busy !== null} onClick={() => onSet(r.id, false)}>
            Off
          </button>
        </div>
      ))}
      {loose.length > 0 && <p className="hv-lt-note">Not on the map yet: {loose.map((l) => `${l.name} (${l.type})`).join(", ")}. Tell Skippy where each one hangs.</p>}
      {down.length > 0 && <p className="hv-lt-note">{down.join(" and ")} didn't answer just now.</p>}
      {note && (
        <p className="hv-lt-note" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
