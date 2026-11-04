import { useEffect, useRef, useState } from "react";
import { useDeskAuth } from "./signin.ts";
import { Private } from "./Private.tsx";
import { homeLine, loadGoogle, startHome, THERMO_MAX_F, THERMO_MIN_F, useHome, VENDOR_NAME, type DeviceReading, type HavenGoogle, type ThermoMode } from "./homeDevices.ts";
import { navigateTo } from "../route.ts";

/**
 * The Home chip on Today (#632, docs/HOME-DEVICES.md): the vacuum, the Petlibro feeders and fountain, and the
 * Litter-Robot. Signed out, how many devices and how many are offline, nothing more. Signed in, it opens each device's
 * state and its buttons (every action goes through the server's rails: the feed cap, the litter gate, named rooms),
 * Since #637 it also holds the Nest thermostat (its set point stepped a degree at a time and its mode, inside the
 * server's 60 to 80 °F rails). Readings and device buttons only: connecting Roborock, Nest and Google Tasks is set up on
 * Boiler Room > Controls (#647, boiler/HouseSetup.tsx), and the chip links there while something waits. Hidden where
 * there's no devices route (the Vercel copy, a local build).
 */

const KIND_WORD: Record<DeviceReading["kind"], string> = { thermostat: "Thermostat", vacuum: "Vacuum", "dry-feeder": "Dry food feeder", "wet-feeder": "Wet food feeder", fountain: "Fountain", litter: "Litter-Robot" };

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
  const [portions, setPortions] = useState(1);
  const [vmode, setVmode] = useState<"" | "quiet" | "max" | "dry" | "mop">("");
  const off = !d.online || busy !== null;
  const facts: string[] = [];
  if (d.kind === "vacuum") facts.push(`battery ${pctOf(d.battery)}`);
  if (d.kind === "dry-feeder" || d.kind === "wet-feeder") facts.push(d.foodLow ? "food low" : "food ok", `last fed ${ago(d.lastFed)}`, `${d.manualToday ?? 0} of ${d.manualCap ?? 2} today`);
  if (d.kind === "wet-feeder" && d.plate) facts.push(`bowl ${d.plate} in front`);
  if (d.kind === "fountain") facts.push(`water ${pctOf(d.water)}`, `filter ${pctOf(d.filter)}`);
  if (d.kind === "litter") facts.push(`drawer ${pctOf(d.drawer)}`, `last use ${ago(d.lastUse)}`);
  if (d.kind === "thermostat") {
    facts.push(typeof d.tempF === "number" ? `${d.tempF}°F inside` : "no reading", `humidity ${pctOf(d.humidity)}`);
    if (d.mode === "heatcool") facts.push(`set ${d.heatF ?? "?"}–${d.coolF ?? "?"}°F`);
    else if (d.mode === "heat" || d.mode === "cool") facts.push(`set ${(d.mode === "heat" ? d.heatF : d.coolF) ?? "?"}°F`);
  }
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
                <select aria-label="Vacuum mode" value={vmode} onChange={(e) => setVmode(e.target.value as typeof vmode)}>
                  <option value="">As set</option>
                  <option value="quiet">Quiet</option>
                  <option value="max">Max</option>
                  <option value="dry">Vacuum only</option>
                  <option value="mop">Mop too</option>
                </select>
                <button
                  type="button"
                  disabled={off || !room}
                  onClick={() => void act("vacuum.rooms", d.id, [room], vmode === "quiet" || vmode === "max" ? { suction: vmode } : vmode === "dry" ? { water: "off" } : vmode === "mop" ? { water: "on" } : undefined)}
                >
                  Clean room
                </button>
              </span>
            ) : null}
          </>
        )}
        {d.kind === "dry-feeder" && (
          <>
            <select aria-label="Portions" value={portions} disabled={off} onChange={(e) => setPortions(Number(e.target.value))}>
              {Array.from({ length: Math.max(1, (d.manualCap ?? 2) - (d.manualToday ?? 0)) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button type="button" disabled={off || (d.manualToday ?? 0) + portions > (d.manualCap ?? 2)} onClick={() => void act("feeder.feed", d.id, undefined, { portions })}>
              Feed {portions === 1 ? "1 portion" : `${portions} portions`}
            </button>
          </>
        )}
        {d.kind === "wet-feeder" && (
          <>
            <button type="button" disabled={off || (d.manualToday ?? 0) >= (d.manualCap ?? 2)} onClick={() => void act("wet.open", d.id)}>Open the tray</button>
            {d.state === "lid open" ? (
              <button type="button" disabled={off} onClick={() => void act("wet.close", d.id)}>Close the lid</button>
            ) : (
              <button type="button" disabled={off} onClick={() => void act("wet.rotate", d.id)}>Next bowl</button>
            )}
            <button type="button" disabled={off} onClick={() => void act("wet.status", d.id)}>What's in it</button>
          </>
        )}
        {d.kind === "thermostat" && <ThermoControls d={d} off={off} />}
        {d.kind === "litter" && (
          <button type="button" disabled={off || d.state !== "ready"} onClick={() => void act("litter.clean", d.id)}>Clean now</button>
        )}
      </div>
    </li>
  );
}

const MODE_WORD: Record<ThermoMode, string> = { heat: "Heat", cool: "Cool", heatcool: "Heat and cool", off: "Off" };

/** A degree down or up from where it is set, and the mode; the server's rails check every change. */
function ThermoControls({ d, off }: { d: DeviceReading; off: boolean }) {
  const act = useHome((s) => s.act);
  const one = d.mode === "heat" ? d.heatF : d.mode === "cool" ? d.coolF : null;
  const step = (by: number) => {
    if (typeof one !== "number") return;
    void act("thermostat.set", d.id, undefined, { tempF: Math.max(THERMO_MIN_F, Math.min(THERMO_MAX_F, one + by)) });
  };
  const canStep = typeof one === "number" && !d.eco;
  return (
    <>
      <button type="button" aria-label="One degree cooler" disabled={off || !canStep || (one ?? 0) <= THERMO_MIN_F} onClick={() => step(-1)}>−1°</button>
      <button type="button" aria-label="One degree warmer" disabled={off || !canStep || (one ?? 0) >= THERMO_MAX_F} onClick={() => step(1)}>+1°</button>
      {d.modes?.length ? (
        <select aria-label="Thermostat mode" value={d.mode ?? ""} disabled={off} onChange={(e) => void act("thermostat.mode", d.id, undefined, { mode: e.target.value as ThermoMode })}>
          {d.modes.map((m) => (
            <option key={m} value={m}>
              {MODE_WORD[m]}
            </option>
          ))}
        </select>
      ) : null}
      {d.eco ? <small>Eco is on: change it in the Home app.</small> : null}
    </>
  );
}

/** To the house's setup on Boiler Room > Controls (#647). */
function toSetup(e: React.MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigateTo("/boiler/controls" + window.location.search);
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("ct-house")?.scrollIntoView({ block: "start" })));
}

/** Google sends a connect back to Today (`/?haven=…`); the setup lives on Controls now, so the result goes on there. */
function forwardHavenResult() {
  try {
    const q = new URLSearchParams(window.location.search);
    const r = q.get("haven");
    if (!r || !/^(nest|tasks)-(connected|cancelled|failed)$|^refused$/.test(r)) return;
    navigateTo(`/boiler/controls?haven=${r}`);
  } catch {
    /* no address to read */
  }
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
  useEffect(forwardHavenResult, []);
  const [google, setGoogle] = useState<HavenGoogle | null>(null);
  useEffect(() => {
    if (open && signedIn) void loadGoogle().then(setGoogle);
  }, [open, signedIn]);

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
  const down = (["roborock", "petlibro", "whisker", "nest"] as const).filter((v) => view.vendors[v] === "down");
  const setupWaiting = !view.roborockConnected || (google !== null && (!google.google || !google.nest.connected || !google.tasks.connected));
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
            {setupWaiting ? (
              <p className="hd-note">
                <a href="/boiler/controls#ct-house" onClick={toSetup}>
                  Set up in Boiler Room →
                </a>
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
