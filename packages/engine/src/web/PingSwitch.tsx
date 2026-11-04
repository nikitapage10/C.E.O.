import { useEffect } from "react";
import { usePings, type PingState, type PingSupport } from "./pings.ts";
import { useDeskAuth } from "./signin.ts";

/**
 * "Pings on this device" (#135): one switch on the signed-in bar of the Foundry tab, in the Desk's own look. On, this
 * device gets one notification when something needs Nikita's call (api/desk-pings.ts). On an iPhone or iPad in
 * Safari, one line says to add the Desk to the home screen first, since iOS only offers pings there.
 */

export const HOME_SCREEN_HINT = "Pings need the Desk on your home screen first: Share, then Add to Home Screen.";

export interface PingSwitchProps {
  support: PingSupport;
  state: PingState;
  note?: string;
  onToggle: () => void;
}

/** The switch as it looks for a given state; DeskPings wires it to the store. */
export function PingSwitchView({ support, state, note, onToggle }: PingSwitchProps) {
  if (support === "unsupported") return null;
  const on = state === "on";
  const disabled = support !== "ok" || state === "busy" || state === "checking" || state === "blocked" || state === "not-set-up";
  return (
    <div className="desk-auth__pings">
      <button type="button" role="switch" aria-checked={on} className={`desk-switch${on ? " desk-switch--on" : ""}`} disabled={disabled} onClick={onToggle}>
        <i className="desk-switch__track" aria-hidden="true">
          <i className="desk-switch__knob" />
        </i>
        Pings on this device
      </button>
      {support === "home-screen" ? (
        <span className="desk-auth__quiet">{HOME_SCREEN_HINT}</span>
      ) : note ? (
        <span className="desk-auth__note">{note}</span>
      ) : on ? (
        <span className="desk-auth__quiet">Only when something needs your call; quiet from 10pm to 7am.</span>
      ) : null}
    </div>
  );
}

/** The switch wired to this device's pings and the Desk's session. */
export function DeskPings() {
  const { support, state, note, check, turnOn, turnOff } = usePings();
  useEffect(() => {
    void check();
  }, [check]);
  return (
    <PingSwitchView
      support={support}
      state={state}
      note={note}
      onToggle={() => {
        if (state === "on") void turnOff();
        else void turnOn().then((r) => r === "signed-out" && useDeskAuth.getState().lost());
      }}
    />
  );
}
