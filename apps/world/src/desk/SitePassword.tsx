import { useEffect, useState } from "react";
import { useDeskAuth } from "./signin.ts";

/**
 * "Site password" (#236): one small control on the Foundry tab's signed-in bar, beside the pings switch. Signed in to
 * the Desk with a passkey, Nikita sets the password the whole site asks for once per device (api/_site/control.ts),
 * changes it, signs every other device out, or turns the lock off. Until a password is set, the site stays open.
 */

export interface SiteStatus {
  on: boolean;
  source: "blob" | "env" | "none" | "off";
  set?: string;
  second?: boolean;
}

/** One line on what the lock is doing now. */
export function statusLine(s: SiteStatus | null): string {
  if (!s) return "";
  if (s.source === "off") return "Off: SITE_GATE=off is set in Vercel.";
  if (!s.on) return "Off: anyone with the address can open the site.";
  if (s.source === "env") return "On, with the password from Vercel's settings (SITE_PASSWORD_HASH).";
  return `On since ${s.set ? new Date(s.set).toLocaleDateString() : "it was set"}. Each device signs in once.`;
}

const PROBLEM: Record<string, string> = {
  "too-short": "At least 10 characters.",
  "too-long": "At most 256 characters.",
  blank: "Not just spaces.",
  "not-set-up": "The site's store isn't set up on the server.",
};

async function call(method: "GET" | "POST", body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch("/api/site-password", {
    method,
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

export function SitePassword() {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const done = (r: { status: number; data: Record<string, unknown> }, ok: string) => {
    setBusy(false);
    if (r.status === 401) return void useDeskAuth.getState().lost();
    if (r.status !== 200) return setNote(PROBLEM[String(r.data.error)] ?? "That didn't go through. Try again.");
    setStatus(r.data as unknown as SiteStatus);
    setPw("");
    setAgain("");
    setNote(ok);
  };

  useEffect(() => {
    let live = true;
    void call("GET")
      .then((r) => live && r.status === 200 && setStatus(r.data as unknown as SiteStatus))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <details className="desk-auth__devices desk-site" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Site password{status ? (status.on ? " · on" : " · off") : ""}</summary>
      <p className="desk-auth__quiet">{statusLine(status)}</p>
      <form
        className="fy-idea__form desk-auth__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw !== again) return setNote("The two don't match.");
          setBusy(true);
          setNote("");
          void call("POST", { action: "set", password: pw }).then((r) => done(r, "Saved. Other devices sign in with it once."), () => done({ status: 0, data: {} }, ""));
        }}
      >
        <label>
          {status?.on && status.source === "blob" ? "New password" : "Password"}
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={10} maxLength={256} />
        </label>
        <label>
          Again
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" minLength={10} maxLength={256} />
        </label>
        <button type="submit" className="btn btn--go btn--sm" disabled={busy || pw.length < 10 || !again}>
          {status?.on && status.source === "blob" ? "Change it" : "Set it and lock the site"}
        </button>
      </form>
      {status?.on ? (
        <div className="desk-auth__actions">
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void call("POST", { action: "signout-all" }).then((r) => done(r, "Every other device is signed out of the site."), () => done({ status: 0, data: {} }, ""));
            }}
          >
            Sign out everywhere else
          </button>
          {status.source === "blob" && (
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Turn the site password off? Anyone with the address can open the site again.")) return;
                setBusy(true);
                void call("POST", { action: "off" }).then((r) => done(r, "The site is open again."), () => done({ status: 0, data: {} }, ""));
              }}
            >
              Turn off
            </button>
          )}
        </div>
      ) : null}
      {note && (
        <p className="desk-auth__note" role="status">
          {note}
        </p>
      )}
    </details>
  );
}
