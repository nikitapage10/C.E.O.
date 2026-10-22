import { useEffect, useState } from "react";
import { useDeskAuth } from "./signin.ts";

/**
 * "Site lock" (#236, #238): one small control on the Foundry tab's signed-in bar, beside the pings switch. Signed in
 * to the Desk with a passkey, Nikita locks the whole site with that passkey as the only way in
 * (api/_site/control.ts), signs every other device out, or unlocks it. No password (Nikita, 2026-10-22). Until it's
 * locked, the site stays open. (The file keeps its #236 name so the Desk's other work doesn't trip over a rename.)
 */

export interface SiteStatus {
  on: boolean;
  source: "blob" | "none" | "off";
  locked?: string;
  second?: boolean;
}

/** One line on what the lock is doing now. */
export function statusLine(s: SiteStatus | null): string {
  if (!s) return "";
  if (s.source === "off") return "Off: SITE_GATE=off is set in Vercel.";
  if (!s.on) return "Off: anyone with the address can open the site.";
  return `Locked${s.locked ? ` since ${new Date(s.locked).toLocaleDateString()}` : ""}: each device signs in once with your Desk passkey.`;
}

/** How Nikita gets back in on any device: said before locking and while locked (#238). */
export const RECOVERY =
  "A passkey saved in Google Password Manager works on your other Chrome devices too. A new device with no passkey adds itself on the login page with the Desk key. Lose every passkey and the Desk key, and only SITE_GATE=off in Vercel (and a redeploy) gets you back in.";

const PROBLEM: Record<string, string> = {
  "not-set-up": "The site's store isn't set up on the server.",
  "not-locked": "The site isn't locked.",
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
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    void call("GET")
      .then((r) => live && r.status === 200 && setStatus(r.data as unknown as SiteStatus))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const post = (action: "lock" | "signout-all" | "off", ok: string) => {
    setBusy(true);
    setNote("");
    void call("POST", { action }).then(
      (r) => {
        setBusy(false);
        if (r.status === 401) return void useDeskAuth.getState().lost();
        if (r.status !== 200) return setNote(PROBLEM[String(r.data.error)] ?? "That didn't go through. Try again.");
        setStatus(r.data as unknown as SiteStatus);
        setNote(ok);
      },
      () => {
        setBusy(false);
        setNote("That didn't go through. Try again.");
      },
    );
  };

  return (
    <details className="desk-auth__devices desk-site" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Site lock{status ? (status.on ? " · on" : " · off") : ""}</summary>
      <p className="desk-auth__quiet">{statusLine(status)}</p>
      {status?.on ? <p className="desk-auth__quiet">{RECOVERY}</p> : null}
      <div className="desk-auth__actions">
        {status && !status.on && status.source !== "off" ? (
          <button
            type="button"
            className="btn btn--go btn--sm"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Lock the site? Every device signs in once with your Desk passkey.\n\n${RECOVERY}`)) return;
              post("lock", "Locked. Other devices sign in once with your passkey.");
            }}
          >
            Lock the site
          </button>
        ) : null}
        {status?.on ? (
          <>
            <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => post("signout-all", "Every other device is signed out of the site.")}>
              Sign out everywhere else
            </button>
            {status.source === "blob" && (
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Unlock the site? Anyone with the address can open it again.")) return;
                  post("off", "The site is open again.");
                }}
              >
                Unlock
              </button>
            )}
          </>
        ) : null}
      </div>
      {note && (
        <p className="desk-auth__note" role="status">
          {note}
        </p>
      )}
    </details>
  );
}
