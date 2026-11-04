import { useEffect, useRef, useState } from "react";
import { useDeskAuth } from "./signin.ts";
import { Private } from "./Private.tsx";
import { homeLine, startHome, useHome, VENDOR_NAME, type DeviceReading } from "./homeDevices.ts";

/**
 * The Home chip on Today (#632, docs/HOME-DEVICES.md): the vacuum, the Petlibro feeders and fountain, and the
 * Litter-Robot. Signed out, how many devices and how many are offline, nothing more. Signed in, it opens each device's
 * state and its buttons (every action goes through the server's rails: the feed cap, the litter gate, named rooms),
 * and Connect Roborock. Hidden where there's no devices route (the Vercel copy, a local build).
 */

const KIND_WORD: Record<DeviceReading["kind"], string> = { vacuum: "Vacuum", "dry-feeder": "Dry food feeder", "wet-feeder": "Wet food feeder", fountain: "Fountain", litter: "Litter-Robot" };

function ago(iso: string | null | undefined): string {
  if (!iso) return "not yet";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return "not yet";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

const pctOf = (n: number | null | undefined) => (typeof n === "number" ? `${n}%` : "?");

function Device({ d }: { d: DeviceReading }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const [room, setRoom] = useState("");
  const off = !d.online || busy !== null;
  const facts: string[] = [];
  if (d.kind === "vacuum") facts.push(`battery ${pctOf(d.battery)}`);
  if (d.kind === "dry-feeder" || d.kind === "wet-feeder") facts.push(d.foodLow ? "food low" : "food ok", `last fed ${ago(d.lastFed)}`, `${d.manualToday ?? 0} of ${d.manualCap ?? 2} today`);
  if (d.kind === "fountain") facts.push(`water ${pctOf(d.water)}`, `filter ${pctOf(d.filter)}`);
  if (d.kind === "litter") facts.push(`drawer ${pctOf(d.drawer)}`, `last use ${ago(d.lastUse)}`);
  return (
    <li className="hd-dev">
      <p className="hd-head">
        <b>{KIND_WORD[d.kind]}</b> <span className={`hd-state${d.online ? "" : " is-off"}`}>{d.state}</span>
        <small>
          <Private>
            {d.model} · {d.place}
          </Private>
        </small>
      </p>
      <p className="hd-facts">{facts.join(" · ")}</p>
      {d.alerts.length ? <p className="hd-alerts">{d.alerts.join(" · ")}</p> : null}
      <div className="hd-acts">
        {d.kind === "vacuum" && (
          <>
            <button type="button" disabled={off} onClick={() => void act("vacuum.start", d.id)}>Start</button>
            <button type="button" disabled={off} onClick={() => void act("vacuum.pause", d.id)}>Pause</button>
            <button type="button" disabled={off} onClick={() => void act("vacuum.dock", d.id)}>Dock</button>
            {d.rooms?.length ? (
              <span className="hd-room">
                <select aria-label="Room to clean" value={room} onChange={(e) => setRoom(e.target.value)}>
                  <option value="">Room…</option>
                  {d.rooms.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={off || !room} onClick={() => void act("vacuum.rooms", d.id, [room])}>Clean room</button>
              </span>
            ) : null}
          </>
        )}
        {d.kind === "dry-feeder" && (
          <button type="button" disabled={off || (d.manualToday ?? 0) >= (d.manualCap ?? 2)} onClick={() => void act("feeder.feed", d.id)}>Feed 1 portion</button>
        )}
        {d.kind === "wet-feeder" && (
          <button type="button" disabled={off || (d.manualToday ?? 0) >= (d.manualCap ?? 2)} onClick={() => void act("wet.open", d.id)}>Open the tray</button>
        )}
        {d.kind === "litter" && (
          <button type="button" disabled={off || d.state !== "ready"} onClick={() => void act("litter.clean", d.id)}>Clean now</button>
        )}
      </div>
    </li>
  );
}

function ConnectRoborock({ connected }: { connected: boolean }) {
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

export function HomeDevices() {
  const status = useDeskAuth((s) => s.auth.status);
  const load = useHome((s) => s.load);
  const pub = useHome((s) => s.pub);
  const view = useHome((s) => s.view);
  const said = useHome((s) => s.said);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const signedIn = status === "in";

  useEffect(() => startHome(), []);

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", off);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", off);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  if (load === "off" || load === "idle" || !pub) return null;
  const words = homeLine(pub);

  if (!signedIn || !view) {
    if (!pub.devices.length) return null;
    return (
      <div className="cf-cu hd">
        <span className="cf-cu-btn hd-btn">
          <span className="cf-cu-k">Home</span>
          <span>{words}</span>
        </span>
      </div>
    );
  }
  const waiting = (["petlibro", "whisker"] as const).filter((v) => view.vendors[v] === "waiting");
  const down = (["roborock", "petlibro", "whisker"] as const).filter((v) => view.vendors[v] === "down");
  return (
    <div className="cf-cu hd" ref={box}>
      <button type="button" className="cf-cu-btn hd-btn" aria-expanded={open} aria-controls="hd-pop" onClick={() => setOpen((x) => !x)}>
        <span className="cf-cu-k">Home</span>
        <span>{words}</span>
      </button>
      <div id="hd-pop" className="cf-cu-pop hd-pop" hidden={!open}>
        {open && (
          <>
            {said ? <p className="hd-said" role="status">{said}</p> : null}
            {view.devices.length ? (
              <ul className="hd-list" aria-label="Home devices">
                {view.devices.map((d) => (
                  <Device key={d.id} d={d} />
                ))}
              </ul>
            ) : (
              <p className="hd-note">No devices yet.</p>
            )}
            {down.length ? <p className="hd-note">{down.map((v) => VENDOR_NAME[v]).join(" and ")} didn't answer. Trying again in a minute.</p> : null}
            {waiting.length ? <p className="hd-note">{waiting.map((v) => VENDOR_NAME[v]).join(" and ")}: waiting for the login in the Key Vault (docs/HOME-DEVICES.md).</p> : null}
            <ConnectRoborock connected={view.roborockConnected} />
          </>
        )}
      </div>
    </div>
  );
}
