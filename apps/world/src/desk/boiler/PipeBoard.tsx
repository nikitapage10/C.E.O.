import { useEffect, useRef, useState, type ReactNode } from "react";
import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/overpass-mono";
import { navigateTo } from "../../route.ts";
import { refreshWorldClock } from "../../worldClock.ts";
import { useEmail } from "../email/email.ts";
import { groceryAction, isKrogerSignIn } from "../haven/groceries.ts";
import { googleAction } from "../homeDevices.ts";
import { reducedMotion } from "../wvCanvas.ts";
import { pipeHeadline, STATIONS, type Fault, type Fix, type PipeMap } from "./pipes.ts";
import type { PipeScene } from "./pipeScene.ts";
import "./pipes.css";

/**
 * The Boiler Room's Map (#732, the B4 schematic): the pipe map in 3D on the left (boiler/pipeScene.ts, loaded lazily),
 * and the fault panel on the right: one broken thing at a time with its cause, a single Fix button wired to the action
 * the Desk already has for it (a reconnect, a sign-in, a re-run on GitHub, a read of the clock), the steps when there's
 * no button, and the queue of the rest. With nothing broken it says everything is holding. On a phone the map runs top
 * to bottom above the panel. Every word here is a state or a count; the fixes that need a passkey ask for a sign-in.
 */

const LINE = "The Pessimist keeps the boiler. He expected this.";

const NEEDS_SIGN_IN = (f: Fix) => f.kind === "gmail" || f.kind === "google" || f.kind === "kroger" || (f.kind === "nav" && f.signedIn === true);

/** Go to a Desk page, then bring an anchor on it into view once it has drawn. */
function goTo(path: string) {
  const [p, hash] = path.split("#");
  navigateTo(p! + window.location.search);
  if (!hash) return;
  let tries = 0;
  const look = () => {
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ block: "start" });
    else if (tries++ < 30) window.setTimeout(look, 100);
  };
  window.setTimeout(look, 60);
}

/** Run one fault's fix. Returns what to say, or null when the page is leaving for a sign-in. */
async function runFix(fix: Fix): Promise<string | null> {
  switch (fix.kind) {
    case "url":
      window.open(fix.url, "_blank", "noopener,noreferrer");
      return "Opened on GitHub.";
    case "nav":
      goTo(fix.path);
      return null;
    case "gmail":
      await useEmail.getState().connect();
      return useEmail.getState().error ?? "Asked Google. The gauge moves when Gmail answers.";
    case "google": {
      const r = await googleAction({ action: "connect", grant: fix.grant });
      if (r.ok && r.url) {
        window.location.assign(r.url);
        return null;
      }
      return "Google didn't start the sign-in. Try again from Controls.";
    }
    case "kroger": {
      const r = await groceryAction({ action: "connect" });
      if (r.ok && r.url && isKrogerSignIn(r.url)) {
        window.location.assign(r.url);
        return null;
      }
      return "King Soopers didn't start the sign-in. Try again from Controls.";
    }
    case "clock":
      await refreshWorldClock();
      return "Read the clock again.";
  }
}

export function PipeBoard({ map, signedIn, tabs, onOpenRoom }: { map: PipeMap; signedIn: boolean; tabs: ReactNode; onOpenRoom: (room: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<PipeScene | null>(null);
  const [gl, setGl] = useState<"wait" | "on" | "none">("wait");
  const [cur, setCur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const faults = map.faults;
  const fault: Fault | null = faults.find((f) => f.id === cur) ?? faults[0] ?? null;
  const head = pipeHeadline(faults);
  const bad = faults.filter((f) => f.kind !== "late");

  const say = (t: string) => {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Tapping a station: its fault, or a word on its reading.
  const pick = useRef<(id: string) => void>(() => undefined);
  pick.current = (id: string) => {
    const f = faults.find((x) => x.station === id);
    if (f) return setCur(f.id);
    const st = STATIONS.find((s) => s.id === id);
    const r = map.stations[id];
    if (st && r) say(`${st.name} · ${r.note || (r.state === "dry" ? "not connected yet" : "holding pressure")}`);
  };

  // The 3D map, once.
  useEffect(() => {
    let gone = false;
    void import("./pipeScene.ts")
      .then(({ PipeScene, canDraw3D }) => {
        if (gone || !host.current) return;
        if (!canDraw3D()) return setGl("none");
        try {
          scene.current = new PipeScene(host.current, { reduce: reducedMotion(), onPick: (id) => pick.current(id) });
          setGl("on");
        } catch {
          setGl("none");
        }
      })
      .catch(() => setGl("none"));
    return () => {
      gone = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  // The stations' states and the fault in view.
  const sig = JSON.stringify(Object.values(map.stations).map((s) => s.state));
  useEffect(() => {
    if (gl !== "on" || !scene.current) return;
    scene.current.set(Object.fromEntries(Object.values(map.stations).map((s) => [s.id, s.state])), fault?.station ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, sig, fault?.station]);

  const fix = async (f: Fault) => {
    if (!f.fix) return;
    setBusy(true);
    try {
      const said = await runFix(f.fix);
      if (said) say(said);
    } finally {
      setBusy(false);
    }
  };

  const queue = (
    <div className="bp-queue">
      <small>{faults.length ? "Queue" : "All lines"}</small>
      {faults.length ? (
        faults.map((g) => (
          <button key={g.id} type="button" aria-current={g === fault} onClick={() => setCur(g.id)}>
            <i className={`is-${g.kind}`} aria-hidden="true" />
            {g.title.replace(/\.$/, "")}
          </button>
        ))
      ) : (
        <p className="bp-count">
          {map.counts.ok} holding{map.counts.dry ? ` · ${map.counts.dry} not connected yet` : ""}
        </p>
      )}
      <p className="bp-flav">{LINE}</p>
    </div>
  );

  const roomOf = fault ? (STATIONS.find((s) => s.id === fault.station)?.room ?? null) : null;
  const n = fault && fault.kind !== "late" ? bad.indexOf(fault) + 1 : 0;

  return (
    <section className="bp" aria-label="The pipes">
      <div className="bp-top">
        <h1 className="bp-h desk__title">
          Boiler Room · <span className={head.ok ? "is-ok" : undefined}>{head.text}</span>
        </h1>
        <p className="bp-sub">
          {map.counts.ok} of {map.counts.total} stations holding pressure{map.counts.dry ? ` · ${map.counts.dry} not connected yet` : ""}
        </p>
        {tabs}
      </div>
      <div className={`bp-map is-${gl}`} ref={host}>
        {gl === "none" ? <p className="bp-nogl">The 3D map needs WebGL. Every fault is still in the panel.</p> : null}
        <div className={`bp-toast${toast ? " is-on" : ""}`} role="status">
          {toast}
        </div>
        <ul className="bp-key" aria-hidden="true">
          <li>
            <i className="is-ok" />
            flowing
          </li>
          <li>
            <i className="is-late" />
            late
          </li>
          <li>
            <i className="is-leak" />
            leak or shut
          </li>
          <li>
            <i className="is-planned" />
            planned
          </li>
        </ul>
      </div>
      <aside className="bp-panel" aria-live="polite">
        {fault ? (
          <>
            <p className={`bp-k is-${fault.kind}`}>
              <b>
                {fault.kind === "late" ? "Running late" : `Fault ${n} of ${bad.length}`} · {fault.line}
              </b>
              <span>{fault.since}</span>
            </p>
            <h2 className="bp-title">{fault.title}</h2>
            <p>{fault.body}</p>
            <div className="bp-route" aria-label={`${fault.route.join(", ")}`}>
              {fault.route[0]} <i aria-hidden="true" /> {fault.route[1]} <i className="is-bad" aria-hidden="true" /> <em>{fault.route[2]} ✕</em>
            </div>
            {fault.fix ? (
              !signedIn && NEEDS_SIGN_IN(fault.fix) ? (
                <p className="bp-note">Sign in on the Desk to fix this one.</p>
              ) : (
                <button className={`bp-fix is-${fault.kind}`} type="button" disabled={busy} onClick={() => void fix(fault)}>
                  {busy ? "Working…" : fault.fix.label}
                </button>
              )
            ) : null}
            {fault.steps.length ? (
              <ol>
                {fault.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            ) : null}
            {roomOf ? (
              <button className="bp-more" type="button" onClick={() => onOpenRoom(roomOf)}>
                Its whole line →
              </button>
            ) : null}
            {queue}
          </>
        ) : (
          <>
            <p className="bp-k is-ok">
              <b>All lines</b>
              <span>just now</span>
            </p>
            <h2 className="bp-title">Everything is holding.</h2>
            <p>Every connected pipe has pressure and nothing is leaking. Nothing here needs you.</p>
            {queue}
          </>
        )}
      </aside>
    </section>
  );
}
