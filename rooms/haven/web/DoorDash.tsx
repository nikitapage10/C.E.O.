import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { DD_NOTE, doordashAction, expiryWords, loadDoorDash, type DdAction, type DdReply, type DdView } from "./doordash.ts";

/**
 * The Kitchen's DoorDash card (#1195, phase 0: Connect; api/_haven/doordash/route.ts). DoorDash's own CLI runs on the
 * server; signing in is its remote two-step: **Sign in to DoorDash** opens DoorDash's page in a new tab, the page ends
 * on "localhost refused to connect" (expected), and Nikita pastes that address here and taps **Finish**. The token
 * lasts about 72 hours and can't renew itself, so the card says when it runs out. Ordering comes in a later phase.
 */

const TAG: Record<DdView["state"], string> = { "not-set-up": "not set up", "signed-out": "signed out", live: "live", expired: "expired" };

export function DoorDashCard() {
  const [view, setView] = useState<DdView | null>(null);
  const [load, setLoad] = useState<"idle" | "off" | "failed" | "ready">("idle");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // A sign-in in progress: DoorDash's page, and until when it can be finished.
  const [signin, setSignin] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  const refresh = useCallback(() => {
    void loadDoorDash().then((l) => {
      if (l.state === "ready") {
        setView(l.view);
        setLoad("ready");
      } else if (l.state === "out") useDeskAuth.getState().lost();
      else setLoad(l.state);
    });
  }, []);
  useEffect(refresh, [refresh]);

  const run = async (body: DdAction): Promise<DdReply> => {
    setBusy(true);
    setNote(null);
    const r = await doordashAction(body);
    setBusy(false);
    if (r.status === 401) useDeskAuth.getState().lost();
    if (r.view) setView(r.view);
    if (!r.ok) setNote(DD_NOTE[r.error ?? "failed"] ?? DD_NOTE.failed!);
    return r;
  };

  const start = async () => {
    // Opened now, on the tap, so the browser lets it through; pointed at DoorDash once the server answers.
    const tab = window.open("", "_blank");
    const r = await run({ action: "signin-start" });
    if (!r.ok || !r.url) {
      tab?.close();
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = r.url;
    }
    setSignin(r.url);
    setPasted("");
  };

  const finish = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run({ action: "signin-finish", pasted: pasted.trim() });
    if (r.ok) {
      setSignin(null);
      setPasted("");
    } else if (r.error === "no-pending" || r.error === "refused") setSignin(null);
  };

  const state = view?.state ?? null;
  return (
    <section className="hv-card hv-groc hv-dd" aria-label="DoorDash">
      <header>
        <h3>DoorDash</h3>
        {state ? <span className="hv-tag">{TAG[state]}</span> : null}
      </header>
      {load === "off" ? (
        <p className="hv-note">DoorDash isn't on this server.</p>
      ) : !view ? (
        <p className="hv-note">{load === "failed" ? "DoorDash didn't load. It'll try again when you come back." : "Reading DoorDash…"}</p>
      ) : state === "not-set-up" ? (
        <p className="hv-note">{DD_NOTE["not-set-up"]}</p>
      ) : state === "live" ? (
        <>
          <p className="hv-note">Signed in, {expiryWords(view.expiresAt)}.</p>
          <button type="button" className="hv-btn" disabled={busy} onClick={() => void run({ action: "signout" })}>
            Sign out
          </button>
        </>
      ) : signin ? (
        <form onSubmit={(e) => void finish(e)}>
          <p className="hv-note">
            Sign in on DoorDash&apos;s page (
            <a href={signin} target="_blank" rel="noopener noreferrer">
              open it again
            </a>
            ). It ends on a &quot;localhost refused to connect&quot; page: that&apos;s expected. Copy that page&apos;s whole address and paste it here, within 10 minutes.
          </p>
          <label className="hv-ddPaste">
            <span>Paste the address the page landed on</span>
            <input type="text" inputMode="url" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="http://localhost:4180/…" />
          </label>
          <div className="hv-btns">
            <button type="submit" className="hv-btn" disabled={busy || !pasted.trim()}>
              {busy ? "Finishing…" : "Finish"}
            </button>
            <button type="button" className="hv-btn" disabled={busy} onClick={() => setSignin(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="hv-note">{state === "expired" ? `Your DoorDash sign-in ${expiryWords(view.expiresAt)}. Sign in again.` : "Not signed in. A sign-in lasts about three days."}</p>
          <button type="button" className="hv-btn is-pri" disabled={busy} onClick={() => void start()}>
            {busy ? "Opening DoorDash…" : "Sign in to DoorDash"}
          </button>
        </>
      )}
      {note ? (
        <p className="hv-note is-warn" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}
