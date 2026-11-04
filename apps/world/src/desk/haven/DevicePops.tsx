import { useEffect, useRef, useState, type ReactNode } from "react";
import { closeClock, useHome, type ActExtra, type DeviceReading, type VendorState } from "../homeDevices.ts";
import type { HavenPlan } from "./data.ts";
import { DryFeederArt, FountainArt, LitterArt, VacuumArt, WetFeederArt } from "./DeviceArt.tsx";
import { RoomMap, vacuumName } from "./RoomMap.tsx";

/**
 * The gauges' pop-ups (#718): tap Roborock, Petlibro or Whisker on the strip and its controls open over it. Only the
 * device actions that exist (docs/HOME-DEVICES.md): the vacuum's start, pause, dock and rooms with its mode words; the
 * dry feeder's portions, the wet feeder's tray (open, next bowl, close, what's in it); the Litter-Robot's clean cycle.
 * Every one goes through the server's rails and is logged to the Council; Skippy's line comes back under the buttons.
 */

const find = (devices: DeviceReading[] | null, kind: DeviceReading["kind"]) => devices?.find((d) => d.kind === kind) ?? null;

function ago(iso: string | null | undefined): string {
  if (!iso) return "not yet";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return "not yet";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** A pop-up's frame: its name, a close, Escape to close, and Skippy's last line at the foot. */
function Pop({ title, tag, onClose, children }: { title: string; tag?: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const said = useHome((s) => s.said);
  const busy = useHome((s) => s.busy);
  // Only what was said after it opened.
  const [opened] = useState(() => useHome.getState().said);
  useEffect(() => {
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  return (
    <div className="hv-dp" role="dialog" aria-label={title} tabIndex={-1} ref={box}>
      <div className="hv-th-top">
        <span className="hv-uk">
          {title}
          {tag && <em> · {tag}</em>}
        </span>
        <button type="button" className="hv-th-x" aria-label={`Close ${title}`} onClick={onClose}>
          ×
        </button>
      </div>
      {children}
      <p className="hv-dp-said" role="status">
        {busy ? "Sending…" : said && said !== opened ? said : ""}
      </p>
    </div>
  );
}

function Waiting({ vendor, state }: { vendor: string; state: VendorState }) {
  return <p className="hv-dp-note">{state === "down" ? `${vendor} isn't answering. It tries again on the next read.` : `${vendor} isn't connected yet.`}</p>;
}

/* ── Roborock ── */

type Suction = "" | "quiet" | "max";
type Water = "" | "off" | "on";

export function VacuumPop({ devices, plan, state, onClose }: { devices: DeviceReading[] | null; plan: HavenPlan | null; state: VendorState; onClose: () => void }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const v = find(devices, "vacuum");
  const [pick, setPick] = useState<string[]>([]);
  const [suction, setSuction] = useState<Suction>("");
  const [water, setWater] = useState<Water>("");
  if (!v)
    return (
      <Pop title="Roborock" onClose={onClose}>
        <Waiting vendor="Roborock" state={state} />
      </Pop>
    );
  const off = !v.online || busy !== null;
  const names = v.rooms ?? [];
  const toggle = (r: string) => setPick((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));
  const mode: ActExtra = { ...(suction && { suction }), ...(water && { water }) };
  // With the plan, its rooms are picked on the map; chips only for the names the map has and the plan doesn't.
  const onPlan = new Set(plan ? plan.rooms.filter((r) => !r.detached).map((r) => vacuumName(names, r)).filter((n): n is string => !!n) : []);
  const chips = names.filter((n) => !onPlan.has(n));
  const cleaning = /clean|vacuum|mop|segment|room|zone|spot/i.test(v.state) && !/return|dock|charg/i.test(v.state);
  return (
    <Pop title="Roborock" tag={v.online ? v.state : "offline"} onClose={onClose}>
      <div className="hv-dp-hero">
        <VacuumArt state={v.online ? v.state : ""} battery={v.battery} />
        <p>
          <b>{typeof v.battery === "number" ? `${v.battery}%` : "–"}</b>
          <span>battery</span>
          {v.alerts.length > 0 && <span className="is-warn">{v.alerts.join(", ")}</span>}
        </p>
      </div>
      {names.length > 0 && (
        <>
          <p className="hv-dp-k">Where to clean {pick.length ? `· ${pick.length} picked` : "· tap rooms"}</p>
          {plan ? <RoomMap plan={plan} names={names} picked={pick} onToggle={toggle} cleaning={cleaning} disabled={off} /> : null}
          {chips.length > 0 && (
          <div className="hv-chips" role="group" aria-label={onPlan.size ? "More rooms on the vacuum's map" : "Rooms on the vacuum's map"}>
            {chips.map((r) => (
              <button key={r} type="button" className="hv-chip" aria-pressed={pick.includes(r)} disabled={off} onClick={() => toggle(r)}>
                {r}
              </button>
            ))}
          </div>
          )}
        </>
      )}
      <div className="hv-dp-modes">
        <div role="group" aria-label="Suction">
          {(["", "quiet", "max"] as Suction[]).map((s) => (
            <button key={s || "std"} type="button" aria-pressed={suction === s} onClick={() => setSuction(s)}>
              {s === "" ? "Standard" : s === "quiet" ? "Quiet" : "Max"}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Mop">
          {(["", "off", "on"] as Water[]).map((w) => (
            <button key={w || "std"} type="button" aria-pressed={water === w} onClick={() => setWater(w)}>
              {w === "" ? "As set" : w === "off" ? "Vacuum only" : "Mop too"}
            </button>
          ))}
        </div>
      </div>
      <div className="hv-dp-btns">
        <button type="button" className="hv-btn is-pri" disabled={off || !pick.length} onClick={() => void act("vacuum.rooms", v.id, pick, mode).then((ok) => ok && setPick([]))}>
          {pick.length ? `Clean ${pick.join(", ")}` : "Pick rooms to clean"}
        </button>
        <button type="button" className="hv-btn" disabled={off} onClick={() => void act("vacuum.start", v.id, undefined, mode)}>
          Clean everywhere
        </button>
        <button type="button" className="hv-btn" disabled={off} onClick={() => void act("vacuum.pause", v.id)}>
          Pause
        </button>
        <button type="button" className="hv-btn" disabled={off} onClick={() => void act("vacuum.dock", v.id)}>
          Dock
        </button>
      </div>
    </Pop>
  );
}

/* ── Petlibro: the dry feeder, the wet feeder and the fountain ── */

/** A moment of motion after an action lands: the kibble falls, the tray turns, the lid lifts. */
function useFlash(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  return [
    on,
    () => {
      setOn(true);
      window.clearTimeout(t.current);
      t.current = window.setTimeout(() => setOn(false), ms);
    },
  ];
}

export function DryFeederControls({ d }: { d: DeviceReading }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const [feeding, flash] = useFlash(4000);
  const left = Math.max(0, (d.manualCap ?? 2) - (d.manualToday ?? 0));
  const [n, setN] = useState(1);
  const portions = Math.max(1, Math.min(n, left || 1, 6));
  const off = !d.online || busy !== null || left === 0;
  return (
    <div className="hv-dp-dev">
      <DryFeederArt feeding={feeding} low={d.foodLow} />
      <div>
        <p className="hv-dp-name">
          Dry food <span className={d.foodLow ? "is-warn" : undefined}>{!d.online ? "offline" : d.foodLow ? "food low" : "food ok"}</span>
        </p>
        <p className="hv-dp-note">
          Last fed {ago(d.lastFed)} · {d.manualToday ?? 0} of {d.manualCap ?? 2} extra today
        </p>
        <div className="hv-dp-step">
          <button type="button" aria-label="One portion fewer" disabled={off || portions <= 1} onClick={() => setN(portions - 1)}>
            −
          </button>
          <b aria-live="polite">{portions}</b>
          <button type="button" aria-label="One portion more" disabled={off || portions >= Math.min(6, left)} onClick={() => setN(portions + 1)}>
            +
          </button>
          <button type="button" className="hv-btn is-pri" disabled={off} onClick={() => void act("feeder.feed", d.id, undefined, { portions }).then((ok) => ok && flash())}>
            Feed {portions} portion{portions === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WetFeederControls({ d }: { d: DeviceReading }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const [turning, flash] = useFlash(2400);
  const off = !d.online || busy !== null;
  const open = /open|feeding|serving/i.test(d.state) && !/closed/i.test(d.state);
  const left = Math.max(0, (d.manualCap ?? 2) - (d.manualToday ?? 0));
  return (
    <div className="hv-dp-dev">
      <WetFeederArt plate={d.plate} open={open} turning={turning} />
      <div>
        <p className="hv-dp-name">
          Wet food <span>{!d.online ? "offline" : d.closesAt ? `Open, closes at ${closeClock(d.closesAt)}` : d.state}</span>
        </p>
        <p className="hv-dp-note">
          {d.plate ? `Bowl ${d.plate} in front` : "Bowl in front unknown"} · {d.manualToday ?? 0} of {d.manualCap ?? 2} opened today
        </p>
        <div className="hv-dp-btns is-row">
          {/* An opening from here closes itself after two hours (#713): opening again restarts them. */}
          <button type="button" className="hv-btn is-pri" disabled={off || (d.closesAt ? false : open || left === 0)} onClick={() => void act("wet.open", d.id)}>
            {d.closesAt ? "Two more hours" : "Open for 2 hours"}
          </button>
          <button type="button" className="hv-btn" disabled={off || open} onClick={() => void act("wet.rotate", d.id).then((ok) => ok && flash())}>
            Next bowl
          </button>
          <button type="button" className="hv-btn" disabled={off || !open} onClick={() => void act("wet.close", d.id)}>
            Close the lid
          </button>
          <button type="button" className="hv-btn" disabled={off} onClick={() => void act("wet.status", d.id)}>
            What's in it
          </button>
        </div>
      </div>
    </div>
  );
}

export function FountainPanel({ d }: { d: DeviceReading }) {
  const flowing = d.online && !/off|stop|pause|dry|empty/i.test(d.state);
  return (
    <div className="hv-dp-dev">
      <FountainArt level={d.water} flowing={flowing} />
      <div>
        <p className="hv-dp-name">
          Water <span className={typeof d.water === "number" && d.water < 25 ? "is-warn" : undefined}>{d.online ? (typeof d.water === "number" ? `${d.water}%` : d.state) : "offline"}</span>
        </p>
        <p className="hv-dp-note">
          {typeof d.filterDays === "number" ? (d.filterDays < 0 ? `Filter ${-d.filterDays} d overdue` : `Filter in ${d.filterDays} d`) : typeof d.filter === "number" ? `Filter ${d.filter}%` : "Filter –"}
          {typeof d.cleanDays === "number" ? ` · clean ${d.cleanDays < 0 ? `${-d.cleanDays} d overdue` : `in ${d.cleanDays} d`}` : ""}
        </p>
        <p className="hv-dp-note">The fountain runs on its own; it has nothing to send.</p>
      </div>
    </div>
  );
}

export function PetlibroPop({ devices, state, onClose }: { devices: DeviceReading[] | null; state: VendorState; onClose: () => void }) {
  const dry = find(devices, "dry-feeder"), wet = find(devices, "wet-feeder"), water = find(devices, "fountain");
  return (
    <Pop title="Petlibro" onClose={onClose}>
      {!dry && !wet && !water ? <Waiting vendor="Petlibro" state={state} /> : null}
      {dry && <DryFeederControls d={dry} />}
      {wet && <WetFeederControls d={wet} />}
      {water && <FountainPanel d={water} />}
    </Pop>
  );
}

/* ── Whisker: the Litter-Robot ── */

export function LitterControls({ d }: { d: DeviceReading }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const [ran, flash] = useFlash(9000);
  const cycling = ran || /cycl|clean/i.test(d.state);
  const off = !d.online || busy !== null || d.state !== "ready";
  return (
    <div className="hv-dp-dev">
      <LitterArt cycling={cycling} drawer={d.drawer} litter={d.litter} catInside={d.catInside} />
      <div>
        <p className="hv-dp-name">
          Litter-Robot <span>{d.online ? d.state : "offline"}</span>
        </p>
        <p className="hv-dp-note">
          Drawer {typeof d.drawer === "number" ? `${d.drawer}%` : "–"} · litter {typeof d.litter === "number" ? `${d.litter}%` : "–"} · last visit {ago(d.lastUse)}
        </p>
        {d.alerts.length > 0 && <p className="hv-dp-note is-warn">{d.alerts.join(", ")}</p>}
        <button type="button" className="hv-btn is-pri" disabled={off} onClick={() => void act("litter.clean", d.id).then((ok) => ok && flash())}>
          {d.online && d.state !== "ready" ? `Clean cycle waits: ${d.state}` : "Run a clean cycle"}
        </button>
      </div>
    </div>
  );
}

export function WhiskerPop({ devices, state, onClose }: { devices: DeviceReading[] | null; state: VendorState; onClose: () => void }) {
  const litter = find(devices, "litter");
  return (
    <Pop title="Whisker" onClose={onClose}>
      {litter ? <LitterControls d={litter} /> : <Waiting vendor="Whisker" state={state} />}
    </Pop>
  );
}
