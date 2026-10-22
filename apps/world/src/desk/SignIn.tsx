import { useEffect, useState, type ReactNode } from "react";
import { DeskPings } from "./PingSwitch.tsx";
import { SitePassword } from "./SitePassword.tsx";
import { guessDevice, useDeskAuth, waitLine, type AuthResult, type AuthView } from "./signin.ts";

/**
 * The Desk's sign-in step (#132), in the Desk's own look: a passkey button, "Add this device" for enrolling a new
 * one with the Desk key, and once signed in, which device, until when, the enrolled devices and a sign-out. Shown on
 * the Foundry page above the idea cards, and in a card's place when a click needs signing in first.
 */

/** What each outcome tells Nikita. "ok" says nothing: the step simply goes away. */
export const RESULT_LINE: Record<Exclude<AuthResult, "ok">, string> = {
  cancelled: "No passkey went through. If this device isn't enrolled yet, add it first.",
  failed: "That passkey didn't sign in. Try again.",
  locked: "Too many wrong tries.",
  "wrong-key": "That Desk key didn't match.",
  "too-many": "Ten devices are enrolled already. Remove one first.",
  unsupported: "This browser can't use passkeys. Try the Desk on a newer browser or your phone.",
  off: "Sign-in isn't set up on the server yet.",
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export interface SignInProps {
  auth: AuthView;
  now: number;
  /** The line under the buttons after the last try (a RESULT_LINE), if any. */
  note?: string;
  busy?: boolean;
  /** Showing the enrolment form (the Desk key and the device's name). */
  adding?: boolean;
  /** Inside a card: no devices list, and a Cancel. */
  compact?: boolean;
  onSignIn: () => void;
  onAdd: () => void;
  onEnrol: (key: string, label: string) => void;
  onCancel?: () => void;
  onSignOut: () => void;
  onRemove: (id: string) => void;
  defaultLabel: string;
  /** Signed in: the "Pings on this device" switch (#135), shown under the sign-in line. */
  pings?: ReactNode;
  /** Signed in: the "Site password" control (#236), under the pings switch. */
  site?: ReactNode;
}

/** The sign-in step as it looks for a given state; DeskSignIn wires it to the store. */
export function SignInPanel(p: SignInProps) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState(p.defaultLabel);
  const { auth } = p;
  if ((auth.status === "checking" || auth.status === "off") && p.compact && p.onCancel)
    // Inside a card that asked to sign in, while sign-in can't be reached: say so, and give the card back.
    return (
      <aside className="desk-auth desk-auth--compact" aria-label="Desk sign-in">
        <p className="desk-auth__note">{auth.status === "off" ? "Sign-in can't be reached right now. Try again shortly." : "Checking sign-in…"}</p>
        <div className="desk-auth__actions">
          <button type="button" className="btn btn--quiet btn--sm" onClick={p.onCancel}>
            Cancel
          </button>
        </div>
      </aside>
    );
  if (auth.status === "checking" || auth.status === "off") return null;

  if (auth.status === "in") {
    if (p.compact) return null;
    return (
      <aside className="desk-auth desk-auth--in" aria-label="Desk sign-in">
        <p className="desk-auth__line">
          <i className="desk-auth__dot" aria-hidden="true" />
          Signed in on <b>{auth.device}</b>
          {auth.hardUntil ? <span className="desk-auth__quiet"> · stays signed in while you use it, until {clock(auth.hardUntil)} at the latest</span> : null}
        </p>
        <div className="desk-auth__actions">
          <details className="desk-auth__devices">
            <summary>Devices ({auth.devices?.length ?? 0})</summary>
            <ul>
              {(auth.devices ?? []).map((d) => (
                <li key={d.id}>
                  <span>
                    {d.label}
                    {d.current ? " (this one)" : ""}
                  </span>
                  <small>added {new Date(d.added).toLocaleDateString()}</small>
                  <button type="button" className="btn btn--quiet btn--sm" disabled={p.busy} onClick={() => p.onRemove(d.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
          <button type="button" className="btn btn--quiet btn--sm" disabled={p.busy} onClick={p.onSignOut}>
            Sign out
          </button>
        </div>
        {p.pings}
        {p.site}
      </aside>
    );
  }

  const locked = auth.lockedUntil && auth.lockedUntil > p.now ? auth.lockedUntil - p.now : 0;
  return (
    <aside className={`desk-auth${p.compact ? " desk-auth--compact" : ""}`} aria-label="Desk sign-in">
      {!p.adding ? (
        <>
          <p className="desk-auth__line">
            <i className="desk-auth__dot desk-auth__dot--out" aria-hidden="true" />
            {p.compact ? "Sign in to the Desk first." : "Signed out. The buttons need a passkey sign-in on this device."}
          </p>
          <div className="desk-auth__actions">
            <button type="button" className="btn btn--go btn--sm" disabled={p.busy || locked > 0} onClick={p.onSignIn}>
              {p.busy ? "Waiting for your passkey…" : "Sign in with a passkey"}
            </button>
            <button type="button" className="btn btn--sm" disabled={p.busy || locked > 0} onClick={p.onAdd}>
              Add this device
            </button>
            {p.onCancel && (
              <button type="button" className="btn btn--quiet btn--sm" onClick={p.onCancel}>
                Cancel
              </button>
            )}
          </div>
        </>
      ) : (
        <form
          className="fy-idea__form desk-auth__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (key && !locked) p.onEnrol(key, label);
          }}
        >
          <label>
            This device&apos;s name
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoComplete="off" />
          </label>
          <label>
            The Desk key, asked once to enrol this device&apos;s passkey
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="current-password" autoFocus />
          </label>
          <button type="submit" className="btn btn--go btn--sm" disabled={!key || p.busy || locked > 0}>
            {p.busy ? "Waiting for your passkey…" : "Add this device"}
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={p.onCancel}>
            Cancel
          </button>
        </form>
      )}
      {locked > 0 ? (
        <p className="desk-auth__note desk-auth__note--locked" role="status">
          Locked for now after too many wrong tries. Try again in {waitLine(locked)}.
        </p>
      ) : (
        p.note && (
          <p className="desk-auth__note" role="status">
            {p.note}
          </p>
        )
      )}
    </aside>
  );
}

/**
 * The sign-in step wired to the Desk's session. `onDone` runs once signed in (a card then carries on with the click
 * that asked for it); `onCancel` puts a card back as it was.
 */
export function DeskSignIn({ compact = false, onDone, onCancel }: { compact?: boolean; onDone?: () => void; onCancel?: () => void }) {
  const auth = useDeskAuth((s) => s.auth);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // The lockout line counts down.
  useEffect(() => {
    if (!auth.lockedUntil || auth.lockedUntil <= now) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [auth.lockedUntil, now]);

  const after = (r: AuthResult) => {
    setBusy(false);
    setNow(Date.now());
    if (r === "ok") {
      setAdding(false);
      setNote("");
      onDone?.();
    } else setNote(RESULT_LINE[r]);
  };
  const { signIn, enrol, signOut, remove } = useDeskAuth.getState();
  return (
    <SignInPanel
      auth={auth}
      now={now}
      note={note}
      busy={busy}
      adding={adding}
      compact={compact}
      defaultLabel={guessDevice(typeof navigator === "undefined" ? "" : navigator.userAgent)}
      pings={compact ? undefined : <DeskPings />}
      site={compact ? undefined : <SitePassword />}
      onSignIn={() => {
        setBusy(true);
        setNote("");
        void signIn().then(after);
      }}
      onAdd={() => (setAdding(true), setNote(""))}
      onEnrol={(key, label) => {
        setBusy(true);
        setNote("");
        void enrol(key, label).then(after);
      }}
      onCancel={adding ? () => (setAdding(false), setNote("")) : onCancel}
      onSignOut={() => void signOut()}
      onRemove={(id) => {
        setBusy(true);
        void remove(id).then(() => setBusy(false));
      }}
    />
  );
}
