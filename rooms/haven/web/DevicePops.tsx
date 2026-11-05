import { useEffect, useRef, useState, type ReactNode } from "react";
import { closeClock, useHome, type ActExtra, type DeviceReading, type VendorState } from "../../../apps/desk/src/homeDevices.ts";
import type { HavenPlan } from "./data.ts";
import { VacuumArt } from "./DeviceArt.tsx";
import { DryStage, FountainStage, LitterStage, WetStage } from "./DevicePlates.tsx";
import { WetTray } from "./PetDay.tsx";
import { RoomMap, vacuumName } from "./RoomMap.tsx";

/**
 * The gauges' pop-ups (#718): tap Roborock, Petlibro or Whisker on the strip and its controls open over it. Only the
 * device actions that exist (docs/HOME-DEVICES.md): the vacuum's start, pause, dock and rooms with its mode words; the
 * dry feeder's portions, the wet feeder's tray (open, next bowl, close, and its three bowls); the Litter-Robot's clean cycle.
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
function Pop({ title, tag, onClose, children, className }: { title: string; tag?: string; onClose: () => void; children: ReactNode; className?: string }) {
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
    <div className={`hv-dp${className ? ` ${className}` : ""}`} role="dialog" aria-label={title} tabIndex={-1} ref={box}>
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

/* ── Roborock: a device sheet (#729) ── */

export type Suction = "" | "quiet" | "max";
export type Water = "" | "off" | "on";

const SUCTION: { v: Suction; name: string }[] = [
  { v: "quiet", name: "Quiet" },
  { v: "", name: "Standard" },
  { v: "max", name: "Max" },
];
const WATER: { v: Water; name: string }[] = [
  { v: "off", name: "Vacuum only" },
  { v: "", name: "As set" },
  { v: "on", name: "Mop too" },
];

/** Where the vacuum is, in a word, from its state. */
export function whereVacuum(state: string, online: boolean): { word: string; tone: "ok" | "busy" | "warn" } {
  if (!online) return { word: "Offline", tone: "warn" };
  const s = state.toLowerCase();
  if (/error|stuck|trapped|fault/.test(s)) return { word: "Needs a hand", tone: "warn" };
  if (/return/.test(s)) return { word: "Heading home", tone: "busy" };
  if (/clean|vacuum|mop|segment|room|zone|spot/.test(s)) return { word: "Cleaning", tone: "busy" };
  if (/pause/.test(s)) return { word: "Paused", tone: "busy" };
  if (/charg/.test(s)) return { word: "Docked · charging", tone: "ok" };
  if (/dock|idle|sleep|full/.test(s)) return { word: "Docked", tone: "ok" };
  return { word: state ? state[0]!.toUpperCase() + state.slice(1) : "Ready", tone: "ok" };
}

/** The battery as a ring. */
function Battery({ pct }: { pct: number | null | undefined }) {
  const v = typeof pct === "number" ? Math.max(0, Math.min(100, pct)) : null;
  const r = 20, c = 2 * Math.PI * r;
  return (
    <span className={`hv-vs-batt${v !== null && v < 20 ? " is-low" : ""}`} role="img" aria-label={v === null ? "Battery unknown" : `Battery ${v}%`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={r} className="hv-vs-battBg" />
        {v !== null && <circle cx="24" cy="24" r={r} className="hv-vs-battFg" strokeDasharray={`${(c * v) / 100} ${c}`} />}
      </svg>
      <b>{v === null ? "–" : v}</b>
      <small>%</small>
    </span>
  );
}

function Segmented<T extends string>({ label, list, value, onPick }: { label: string; list: { v: T; name: string }[]; value: T; onPick: (v: T) => void }) {
  return (
    <div className="hv-vs-seg">
      <span className="hv-vs-k">{label}</span>
      <div role="group" aria-label={label} style={{ ["--n" as string]: list.length, ["--i" as string]: Math.max(0, list.findIndex((x) => x.v === value)) }}>
        <i aria-hidden="true" />
        {list.map((x) => (
          <button key={x.v || "std"} type="button" aria-pressed={value === x.v} onClick={() => onPick(x.v)}>
            {x.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The vacuum's mode words for a clean, as two segmented controls (#729): suction and the mop. The Hall uses them too. */
export function VacuumModes({ suction, water, onSuction, onWater }: { suction: Suction; water: Water; onSuction: (s: Suction) => void; onWater: (w: Water) => void }) {
  return (
    <div className="hv-vs-modes">
      <Segmented label="Suction" list={SUCTION} value={suction} onPick={onSuction} />
      <Segmented label="Mop" list={WATER} value={water} onPick={onWater} />
    </div>
  );
}

/** With the plan, the rooms it draws are picked on the map; the names the vacuum has and the plan doesn't stay chips. */
export function chipsBeside(names: string[], plan: HavenPlan | null): { onPlan: Set<string>; chips: string[] } {
  const onPlan = new Set(plan ? plan.rooms.filter((r) => !r.detached).map((r) => vacuumName(names, r)).filter((n): n is string => !!n) : []);
  return { onPlan, chips: names.filter((n) => !onPlan.has(n)) };
}

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
  const { onPlan, chips } = chipsBeside(names, plan);
  const where = whereVacuum(v.state, v.online);
  const cleaning = where.word === "Cleaning";
  const docked = where.word.startsWith("Docked");
  // One primary action: the rooms picked; else Pause while it cleans; else everywhere.
  const primary = pick.length
    ? { name: `Clean ${pick.join(", ")}`, run: () => void act("vacuum.rooms", v.id, pick, mode).then((ok) => ok && setPick([])) }
    : cleaning
      ? { name: "Pause", run: () => void act("vacuum.pause", v.id) }
      : { name: "Clean everywhere", run: () => void act("vacuum.start", v.id, undefined, mode) };
  return (
    <Pop title="Roborock" tag={v.online ? v.model : "offline"} onClose={onClose} className="is-sheet">
      <div className="hv-vs-head" data-tone={where.tone}>
        <span className="hv-vs-art">
          <VacuumArt state={v.online ? v.state : ""} battery={v.battery} />
        </span>
        <div className="hv-vs-now">
          <b>{where.word}</b>
          <span>{docked ? "On the dock" : cleaning ? "Out on the floor" : v.online ? "Off the dock" : "Not answering"}</span>
        </div>
        <Battery pct={v.battery} />
      </div>
      {v.alerts.length > 0 ? (
        <ul className="hv-vs-alerts" aria-label="Needs attention">
          {v.alerts.map((a) => (
            <li key={a} data-kind={/tank|water/i.test(a) ? "water" : /bin|dust|bag/i.test(a) ? "bin" : "alert"}>
              <i aria-hidden="true" />
              {a[0]!.toUpperCase() + a.slice(1)}
            </li>
          ))}
        </ul>
      ) : null}
      {names.length > 0 && (
        <section className="hv-vs-map" aria-label="Where to clean">
          <div className="hv-vs-mapTop">
            <span className="hv-vs-k">Where to clean</span>
            <span className="hv-vs-count">{pick.length ? `${pick.length} of ${names.length} picked` : "Tap rooms on the plan"}</span>
            {pick.length ? (
              <button type="button" className="hv-vs-link" onClick={() => setPick([])}>
                Clear
              </button>
            ) : (
              <button type="button" className="hv-vs-link" disabled={off} onClick={() => setPick(names)}>
                All rooms
              </button>
            )}
          </div>
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
        </section>
      )}
      <VacuumModes suction={suction} water={water} onSuction={setSuction} onWater={setWater} />
      <button type="button" className="hv-vs-go" disabled={off} onClick={primary.run}>
        {primary.name}
      </button>
      <div className="hv-vs-more">
        {primary.name !== "Clean everywhere" && (
          <button type="button" disabled={off} onClick={() => void act("vacuum.start", v.id, undefined, mode)}>
            Clean everywhere
          </button>
        )}
        {primary.name !== "Pause" && (
          <button type="button" disabled={off} onClick={() => void act("vacuum.pause", v.id)}>
            Pause
          </button>
        )}
        <button type="button" disabled={off || docked} onClick={() => void act("vacuum.dock", v.id)}>
          Dock
        </button>
      </div>
    </Pop>
  );
}

/* ── Petlibro: the dry feeder, the wet feeder and the fountain ── */

/** A moment of motion after an action lands: the kibble falls, the tray turns, the lid lifts. */
export function useFlash(ms: number): [boolean, () => void] {
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
      <span className="hv-dp-stage">
        <DryStage d={d} feeding={feeding} />
      </span>
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
  const [, flash] = useFlash(2400);
  const off = !d.online || busy !== null;
  const open = /open|feeding|serving/i.test(d.state) && !/closed/i.test(d.state);
  const left = Math.max(0, (d.manualCap ?? 2) - (d.manualToday ?? 0));
  return (
    <div className="hv-dp-dev">
      <span className="hv-dp-stage">
        <WetStage d={d} />
      </span>
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
        </div>
        <WetTray d={d} />
      </div>
    </div>
  );
}

export function FountainPanel({ d }: { d: DeviceReading }) {
  return (
    <div className="hv-dp-dev">
      <span className="hv-dp-stage">
        <FountainStage d={d} />
      </span>
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
      <span className="hv-dp-stage">
        <LitterStage d={d} flash={cycling} />
      </span>
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
