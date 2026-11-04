import { useCallback, useEffect, useState } from "react";
import { useDeskAuth } from "../signin.ts";
import { ago } from "../foundryGraph.ts";
import { Private } from "../Private.tsx";
import { ADD_NOTE, GREET_NOTE, addPhone, loadPhones, makeGreetings, revokePhone, type Load, type PhonesView } from "../haven.ts";

/**
 * Boiler Room > Security, signed in only (#627): Phones. Each phone that may talk to Skippy holds a capture key for the
 * iPhone's "Skippy" shortcut (docs/HEY-SKIPPY.md). "Add a phone" shows the new key once, with Copy; the Desk keeps only
 * its hash, so it can never show it again. Each phone shows when it was last used, and Revoke stops its key at once.
 * Below, the greeting clips the shortcut can play when it opens.
 */
export function PhonesPanel({ now }: { now: number }) {
  const status = useDeskAuth((s) => s.auth.status);
  const [load, setLoad] = useState<Load<PhonesView> | null>(null);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ label: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(() => {
    void loadPhones().then((l) => {
      if (l.state === "out") useDeskAuth.getState().lost();
      setLoad(l);
    });
  }, []);

  useEffect(() => {
    if (status === "in") refresh();
    // The new key is forgotten when the session ends or the panel goes.
    else setFresh(null);
  }, [status, refresh]);

  if (status !== "in") return null;
  const view = load?.state === "ready" ? load.view : null;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote("");
    setCopied(false);
    void addPhone(label.trim() || "iPhone").then((r) => {
      setBusy(false);
      if (r.ok) {
        setFresh({ label: r.data.phone.label, key: r.data.key });
        setLabel("");
        refresh();
      } else {
        if (r.status === 401) useDeskAuth.getState().lost();
        setNote(ADD_NOTE[r.error] ?? ADD_NOTE.failed!);
      }
    });
  };

  const copy = () => {
    if (!fresh) return;
    void navigator.clipboard?.writeText(fresh.key).then(
      () => setCopied(true),
      () => setNote("Couldn't copy: select the key and copy it by hand."),
    );
  };

  const revoke = (id: string) => {
    void revokePhone(id).then((r) => {
      if (!r.ok && r.status === 401) useDeskAuth.getState().lost();
      setNote(r.ok ? "Revoked. That phone's key opens nothing now." : "That didn't go through. Try again.");
      refresh();
    });
  };

  const greet = () => {
    setBusy(true);
    setNote("");
    void makeGreetings().then((r) => {
      setBusy(false);
      setNote(r.ok ? `Recorded ${r.data.clips} greeting clips.` : (GREET_NOTE[r.error] ?? GREET_NOTE.failed!));
      refresh();
    });
  };

  const live = view?.phones.filter((p) => !p.revoked) ?? [];
  const gone = view?.phones.filter((p) => p.revoked) ?? [];

  return (
    <section className="fl-below fl-panel sx-keys sx-phones" aria-label="Phones">
      <div className="sx-ghead">
        <div>
          <p className="fl-k">
            <span>Phones</span> · Hey Skippy from the iPhone
          </p>
          <h2 className="fl-h2">Phones that can talk to Skippy</h2>
        </div>
      </div>
      <p className="sx-note sx-keys-intro">
        Each phone gets its own key for the "Skippy" shortcut on the Action Button: shopping goes on the Kitchen list, reminders on your to-dos, anything else to Skippy. The key shows
        once; the Desk keeps only a hash of it. The steps are in docs/HEY-SKIPPY.md.
      </p>
      {!load ? <p className="sx-note">Reading the phones…</p> : null}
      {load?.state === "off" ? <p className="sx-note">Phones live on the Azure copy of the Desk.</p> : null}
      {load?.state === "failed" ? <p className="sx-note">Couldn't read the phones just now.</p> : null}

      {fresh ? (
        <div className="sx-phone-new" role="status">
          <p className="sx-note">
            <b>{fresh.label}</b>'s key. Copy it into the shortcut now: it won't be shown again.
          </p>
          <div className="sx-kf-f">
            <label>
              <span className="sx-note">Key</span>
              <Private>
                <input readOnly value={fresh.key} aria-label="The new phone key" onFocus={(e) => e.currentTarget.select()} spellCheck={false} autoComplete="off" />
              </Private>
            </label>
            <button type="button" className="fl-btn is-pri" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="fl-btn" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {view ? (
        <>
          <ul className="sx-keys-l" aria-label="Phones">
            {live.length === 0 ? <li className="sx-kf sx-note">No phones yet.</li> : null}
            {live.map((p) => (
              <li key={p.id} className="sx-kf is-ok">
                <div className="sx-kf-h">
                  <span className="sx-kf-n">
                    <b>
                      <Private>{p.label}</Private>
                    </b>
                    <code>added {ago(Date.parse(p.created), now)}</code>
                  </span>
                  <span className="sx-kf-s">{p.lastUsed ? `Last used ${ago(Date.parse(p.lastUsed), now)}` : "Not used yet"}</span>
                  <button type="button" className="fl-btn" onClick={() => revoke(p.id)} aria-label={`Revoke ${p.label}`}>
                    Revoke
                  </button>
                </div>
              </li>
            ))}
            {gone.map((p) => (
              <li key={p.id} className="sx-kf is-off">
                <div className="sx-kf-h">
                  <span className="sx-kf-n">
                    <b>
                      <Private>{p.label}</Private>
                    </b>
                    <code>revoked {ago(Date.parse(p.revoked!), now)}</code>
                  </span>
                  <span className="sx-kf-s">{p.lastUsed ? `Last used ${ago(Date.parse(p.lastUsed), now)}` : "Never used"}</span>
                </div>
              </li>
            ))}
          </ul>
          <form className="sx-kf-f" onSubmit={add} autoComplete="off">
            <label>
              <span className="sx-note">Name it, so you know which phone it is</span>
              <input name="phone-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="iPhone 17" disabled={busy} />
            </label>
            <button type="submit" className="fl-btn is-pri" disabled={busy}>
              Add a phone
            </button>
          </form>
          <div className="sx-kf-f sx-phone-greet">
            <p className="sx-note">
              Greeting clips (optional, played when the shortcut opens):{" "}
              {view.greetings.clips ? `${view.greetings.clips} recorded${view.greetings.made ? ` ${ago(Date.parse(view.greetings.made), now)}` : ""}.` : "none recorded yet."}
            </p>
            <button type="button" className="fl-btn" onClick={greet} disabled={busy || !view.voice}>
              {view.greetings.clips ? "Record them again" : "Record greeting clips"}
            </button>
          </div>
        </>
      ) : null}
      {note ? (
        <p className="desk-auth__note" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}
