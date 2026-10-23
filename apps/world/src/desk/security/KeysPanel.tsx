import { useCallback, useEffect, useState } from "react";
import { useDeskAuth } from "../signin.ts";
import { keyLine, loadKeys, prepareStepUp, setKey, SET_NOTE, type KeyRow, type KeysLoad } from "./keys.ts";

/**
 * Boiler Room > Security, signed in only (#330): the Keys form. Set or replace one of the allowlisted keys in the Key
 * Vault without Cloud Shell; each write asks for the passkey again (the device's own unlock). Write-only: the page
 * shows each key's name and whether it is set, and when, never the value. The Desk key, the site bypass, the crew's
 * tokens and the sealing keys aren't on the list; they stay with the Cloud Shell paste (docs/AZURE.md).
 */
export function KeysPanel({ now }: { now: number }) {
  const status = useDeskAuth((s) => s.auth.status);
  const [load, setLoad] = useState<KeysLoad | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void loadKeys().then((l) => {
      if (l.state === "out") useDeskAuth.getState().lost();
      setLoad(l);
    });
  }, []);

  useEffect(() => {
    if (status === "in") refresh();
  }, [status, refresh]);

  if (status !== "in") return null;
  const view = load?.state === "ready" ? load.view : null;

  return (
    <section className="wv-panel wv-keys" aria-label="Keys">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">Keys</p>
          <h2 className="wv-h2">Set a key, never see one</h2>
        </div>
        <p className="wv-note">Each one asks for your passkey</p>
      </div>
      <p className="wv-note wv-keys-intro">
        Paste a new key from the service it belongs to. It goes straight into the Key Vault and the app picks it up within two minutes. Nothing here can read a key back. The Desk key, the
        site lock's bypass and the crew's own tokens aren't on this list: they stay with Cloud Shell.
      </p>
      {!load ? <p className="wv-note">Reading the vault…</p> : null}
      {load?.state === "off" ? <p className="wv-note">Keys live on the Azure copy of the Desk.</p> : null}
      {load?.state === "failed" ? <p className="wv-note">Couldn't read the vault just now.</p> : null}
      {view?.vault === "none" ? <p className="wv-note">The Key Vault isn't connected here yet: the next deploy sets KEY_VAULT_URI.</p> : null}
      {view?.vault === "error" ? <p className="wv-note">The Key Vault didn't answer, so whether each key is set can't be read right now.</p> : null}
      {view ? (
        <ul className="wv-keys-l">
          {view.keys.map((k) => (
            <KeyItem key={k.name} row={k} now={now} open={open === k.name} canSet={view.vault !== "none"} onOpen={(on) => setOpen(on ? k.name : null)} onDone={refresh} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function KeyItem({ row, now, open, canSet, onOpen, onDone }: { row: KeyRow; now: number; open: boolean; canSet: boolean; onOpen: (on: boolean) => void; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) prepareStepUp();
    else setValue("");
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sending = value;
    // The form forgets the value now, whatever happens next.
    setValue("");
    if (!sending.trim()) return setNote(SET_NOTE["bad-value"]);
    setBusy(true);
    setNote("");
    void setKey(row.name, sending).then((r) => {
      setBusy(false);
      if (r === "out") useDeskAuth.getState().lost();
      if (r === "ok") {
        setNote("Set. The app takes it within two minutes.");
        onOpen(false);
        onDone();
      } else setNote(SET_NOTE[r]);
    });
  };

  const tone = row.set === null ? "is-off" : row.set ? "is-ok" : "is-wait";
  return (
    <li className={`wv-kf ${tone}`}>
      <div className="wv-kf-h">
        <span className="wv-kf-n">
          <b>{row.label}</b>
          <code>{row.name}</code>
        </span>
        <span className="wv-kf-s">{keyLine(row, now)}</span>
        {canSet ? (
          <button type="button" className="btn btn--quiet btn--sm" aria-expanded={open} onClick={() => onOpen(!open)}>
            {open ? "Cancel" : row.set ? "Replace" : "Set"}
          </button>
        ) : null}
      </div>
      {open ? (
        <form className="wv-kf-f" onSubmit={submit} autoComplete="off">
          <label>
            <span className="wv-note">New value, from {row.from}</span>
            <input type="password" name={`key-${row.name}`} value={value} onChange={(e) => setValue(e.target.value)} maxLength={4096} autoComplete="new-password" spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={busy} />
          </label>
          <button type="submit" className="btn btn--go btn--sm" disabled={busy || !value.trim()}>
            {busy ? "Waiting for the passkey…" : "Set with passkey"}
          </button>
        </form>
      ) : null}
      {note ? (
        <p className="desk-auth__note" role="status">
          {note}
        </p>
      ) : null}
    </li>
  );
}
