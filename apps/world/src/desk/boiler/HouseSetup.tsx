import { useEffect, useState } from "react";
import { googleAction, loadGoogle, useHome, type HavenGoogle } from "../homeDevices.ts";

/**
 * The house's connections (#637, #632), set up from Boiler Room > Controls (#647; Nikita, 05:53Z: connection setup
 * belongs in the Boiler Room, not on Today): Connect Nest, Connect Google Tasks, the Tasks list it reads and Check
 * now, and Connect Roborock. Moved from Today's Home chip, which keeps the readings and the device buttons.
 */

/** What Google sent back after a connect (`/?haven=nest-connected`, api/_haven/google/route.ts), in words. */
export const HAVEN_RESULT: Record<string, string> = {
  "nest-connected": "Google Nest is connected.",
  "tasks-connected": "Google Tasks is connected.",
  "nest-cancelled": "Connect Nest was cancelled at Google. Nothing was connected.",
  "tasks-cancelled": "Connect Google Tasks was cancelled at Google. Nothing was connected.",
  "nest-failed": "Google didn't hand over access to Nest. Try again.",
  "tasks-failed": "Google didn't hand over access to Tasks. Try again.",
  refused: "That Google link didn't match this session. Try again from here.",
};

function ago(iso: string | null | undefined): string {
  if (!iso) return "not yet";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return "not yet";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Connect Nest, Connect Google Tasks and the Tasks list it reads (#637). */
export function GoogleLinks() {
  const [g, setG] = useState<HavenGoogle | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState(false);
  // Read on its own (/api/haven/google), whether or not any home device is set up.
  const refresh = () => void loadGoogle().then((v) => (setG(v), setRead(true), v && setList(v.tasks.list)));
  useEffect(refresh, []);
  if (!g) return <p className="hd-note">{read ? "Google Nest and Google Tasks connect on the Azure copy of the Desk; it didn't answer here." : "Reading Google's connections…"}</p>;
  const run = async (body: Parameters<typeof googleAction>[0], done?: string) => {
    setBusy(true);
    setNote(null);
    const r = await googleAction(body);
    setBusy(false);
    if (r.url) {
      window.location.assign(r.url);
      return;
    }
    setNote(r.ok ? (done ?? null) : r.error === "no-list" ? `There's no Tasks list called "${list}".` : r.error === "no-project" ? "The Device Access project isn't set up yet." : "That didn't go through. Try again.");
    refresh();
  };
  if (!g.google) return <p className="hd-note">Google Nest and Google Tasks: waiting for the Google client in the Key Vault (docs/HOME-DEVICES.md).</p>;
  return (
    <div className="hd-connect">
      <p>
        <b>Google Nest</b>{" "}
        {!g.nest.project ? (
          "waiting for the Device Access project in the Key Vault."
        ) : g.nest.connected ? (
          <button type="button" disabled={busy} onClick={() => void run({ action: "disconnect", grant: "nest" }, "Nest disconnected.")}>Disconnect</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void run({ action: "connect", grant: "nest" })}>{g.nest.refused ? "Reconnect Nest" : "Connect Nest"}</button>
        )}
      </p>
      <p>
        <b>Google Tasks</b>{" "}
        {g.tasks.connected ? (
          <>
            <button type="button" disabled={busy} onClick={() => void run({ action: "tasks-sync" }, "Checked Tasks.")}>Check now</button>{" "}
            <button type="button" disabled={busy} onClick={() => void run({ action: "disconnect", grant: "tasks" }, "Google Tasks disconnected.")}>Disconnect</button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => void run({ action: "connect", grant: "tasks" })}>{g.tasks.refused ? "Reconnect Google Tasks" : "Connect Google Tasks"}</button>
        )}
      </p>
      {g.tasks.connected ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run({ action: "tasks-list", title: list }, "Saved.");
          }}
        >
          <input aria-label="Google Tasks list to read" value={list} maxLength={60} onChange={(e) => setList(e.target.value)} />
          <button type="submit" disabled={busy || !list.trim()}>Use this list</button>
          <small>
            {g.tasks.lastRun ? `Last check ${ago(g.tasks.lastRun)}: ${g.tasks.lastResult === "no-list" ? "no such list" : `${g.tasks.lastImported} added`}.` : "Checked every five minutes."}
          </small>
        </form>
      ) : null}
      {note ? <small role="status">{note}</small> : null}
    </div>
  );
}

export function ConnectRoborock({ connected }: { connected: boolean }) {
  const connect = useHome((s) => s.connect);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (body: Parameters<typeof connect>[0]) => {
    setBusy(true);
    setNote(null);
    const r = await connect(body);
    setBusy(false);
    return r;
  };
  if (connected) {
    return (
      <p className="hd-connect">
        Roborock is connected.{" "}
        <button type="button" disabled={busy} onClick={() => void go({ step: "disconnect" })}>Disconnect</button>
      </p>
    );
  }
  return (
    <form
      className="hd-connect"
      onSubmit={(e) => {
        e.preventDefault();
        if (step === "email") {
          void go({ step: "send", email }).then((r) => {
            if (r.ok) {
              setStep("code");
              setNote("Roborock emailed you a code. Enter it here.");
            } else setNote(r.say ?? null);
          });
        } else {
          void go({ step: "code", code }).then((r) => {
            setCode("");
            if (r.ok) {
              setEmail("");
              setStep("email");
            } else setNote(r.say ?? null);
          });
        }
      }}
    >
      <b>Connect Roborock</b>
      {step === "email" ? (
        <input type="email" autoComplete="off" placeholder="Roborock account email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      ) : (
        <input inputMode="numeric" autoComplete="one-time-code" placeholder="Code from the email" value={code} onChange={(e) => setCode(e.target.value)} required />
      )}
      <button type="submit" disabled={busy}>{step === "email" ? "Send code" : "Connect"}</button>
      {note ? <small>{note}</small> : null}
    </form>
  );
}


/** Roborock's connect, once the home devices route answers; it holds the account's login on the server. */
export function RoborockSetup() {
  const view = useHome((s) => s.view);
  const load = useHome((s) => s.load);
  if (!view) return <p className="hd-note">Roborock: {load === "off" ? "the home devices route runs on the Azure copy." : "reading the home devices…"}</p>;
  return <ConnectRoborock connected={view.roborockConnected} />;
}
