import { useEffect, useRef, useState, type ReactNode } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";
import { closeClock, useHome, type DeviceReading } from "../../../apps/desk/src/homeDevices.ts";
import { removeItem, undoRemoveItem, type KitchenItem } from "../../../apps/desk/src/haven.ts";
import type { HavenPlan, Lit, PlanRoom, Tab } from "./data.ts";
import { Shopping } from "./Groceries.tsx";
import { DryDay, FountainDay, WetDay } from "./PetDay.tsx";
import { MealPlanner } from "./MealPlanner.tsx";
import { DryStage, FountainStage, LitterStage, Plate, VacuumStage, WetStage } from "./DevicePlates.tsx";
import { flowing, frontBowl } from "./plates.ts";
import { chipsBeside, useFlash, VacuumModes, type Suction, type Water } from "./DevicePops.tsx";
import { RoomMap, vacuumName } from "./RoomMap.tsx";
import { HallLive } from "./LiveRun.tsx";

/**
 * The Haven's room content (#616), shown over the blurred house in the backdrop layout Nikita picked: Kitchen, Hall,
 * Pets and Gym, or a room's own sheet. Real readings only. A part with no source yet says it is waiting, in plain
 * type, and invents nothing. The Kitchen is the meal planner (#678, MealPlanner.tsx) with the list and King Soopers beside it.
 */

export const TAB_NAME: Record<Tab, string> = { kitchen: "Kitchen", hall: "Hall", pets: "Pets", gym: "Gym" };

function ago(iso: string | null | undefined): string {
  if (!iso) return "not yet";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return "not yet";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
const pct = (n: number | null | undefined) => (typeof n === "number" ? `${n}` : "–");

function Num({ v, unit, k, tone }: { v: ReactNode; unit?: string; k: string; tone?: "warn" | "ok" | "wait" }) {
  return (
    <div className={`hv-num${tone ? ` is-${tone}` : ""}`}>
      <b>
        {v}
        {unit && <small>{unit}</small>}
      </b>
      <span>{k}</span>
    </div>
  );
}

function Card({ title, tag, children, wide }: { title: string; tag?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`hv-card${wide ? " is-wide" : ""}`}>
      <header>
        <h3>{title}</h3>
        {tag && <span className="hv-tag">{tag}</span>}
      </header>
      {children}
    </section>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <p className="hv-wait">
      <i aria-hidden="true" />
      {children}
    </p>
  );
}

function Bar({ v, warn }: { v: number | null | undefined; warn?: boolean }) {
  return (
    <span className={`hv-bar${warn ? " is-warn" : ""}`} role="img" aria-label={typeof v === "number" ? `${v}%` : "unknown"}>
      <i style={{ width: `${typeof v === "number" ? Math.max(2, Math.min(100, v)) : 0}%` }} />
    </span>
  );
}

function Said() {
  const said = useHome((s) => s.said);
  return said ? (
    <p className="hv-said" role="status">
      {said}
    </p>
  ) : null;
}

/** The Litter-Robot's state as its plate's one word. */
const litterWord = (s: string) => (s === "cat-inside" ? "cat inside" : s);

/** A device with no reading yet: waiting for its vendor, or its vendor isn't answering. */
const waitFor = (vendor: string, state: string) => (state === "down" ? `${vendor} isn't answering. It tries again on the next read.` : `Waiting for ${vendor}.`);

const find = (devices: DeviceReading[] | null, kind: DeviceReading["kind"]) => devices?.find((d) => d.kind === kind) ?? null;

/* ── Kitchen ── */

export function KitchenTab({ items, onTick, onDrop, onReread }: { items: KitchenItem[] | null; onTick: (i: KitchenItem) => void; onDrop: (i: KitchenItem) => void; onReread: () => void }) {
  const open = items?.filter((i) => !i.done) ?? [];
  // The last item removed, kept five seconds so Undo can bring it back (#673, as Today's Kitchen chip does, #657).
  const [undo, setUndo] = useState<KitchenItem | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);
  const remove = (item: KitchenItem) => {
    onDrop(item);
    window.clearTimeout(undoTimer.current);
    setUndo(item);
    undoTimer.current = window.setTimeout(() => setUndo(null), 5000);
    void removeItem(item.id).then((r) => {
      if (!r.ok) {
        setUndo(null);
        onReread();
      }
    });
  };
  const takeBack = () => {
    if (!undo) return;
    const item = undo;
    window.clearTimeout(undoTimer.current);
    setUndo(null);
    void undoRemoveItem(item.id).then(() => onReread());
  };
  const kroger = useHome((s) => s.view?.links.kroger ?? s.pub?.links.kroger ?? "waiting");
  // One Shopping card (#737): the list by shelf and King Soopers as two tabs, not two cards saying the same items.
  const rail = (
    <Shopping
      items={items}
      onTick={onTick}
      onRemove={remove}
      tag={kroger}
      undo={
        undo ? (
          <p className="hv-undo" role="status">
            <span>Removed.</span>
            <button type="button" onClick={takeBack}>
              Undo
            </button>
          </p>
        ) : null
      }
    />
  );
  return (
    <>
      <p className="hv-say">{items === null ? "Reading the Kitchen list…" : open.length ? `${open.length} thing${open.length === 1 ? "" : "s"} on the list.` : "Nothing on the list."}</p>
      {/* The meal planner (#678) with the list and King Soopers as its rail: one page, no second row of tabs. */}
      <MealPlanner onListChanged={onReread} rail={rail} />
    </>
  );
}

/* ── Hall: the vacuum ── */

export function HallTab({ devices, connected, room, plan }: { devices: DeviceReading[] | null; connected: boolean; room?: PlanRoom; plan?: HavenPlan | null }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const v = find(devices, "vacuum");
  // Opened from a room of its own, that room starts picked (#718).
  const [pick, setPick] = useState<string[]>(() => {
    const own = v && room ? vacuumName(v.rooms ?? [], room) : null;
    return own ? [own] : [];
  });
  const [suction, setSuction] = useState<Suction>("");
  const [water, setWater] = useState<Water>("");
  if (!v)
    return (
      <>
        <p className="hv-say">The vacuum isn't connected yet.</p>
        <Card title="Vacuum" tag="waiting" wide>
          <Waiting>{connected ? "Roborock is connected but sent no vacuum." : "Waiting for Roborock: connect it from Today → Home with the emailed code."}</Waiting>
        </Card>
      </>
    );
  const off = !v.online || busy !== null;
  const rooms = v.rooms ?? [];
  const toggle = (r: string) => setPick((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));
  const { chips } = chipsBeside(rooms, plan ?? null);
  const mode = { ...(suction && { suction }), ...(water && { water }) };
  const cleaning = v.online && /clean|vacuum|mop|segment|room|zone|spot/i.test(v.state) && !/return|dock|charg/i.test(v.state);
  return (
    <>
      <p className="hv-say">
        The vacuum is {v.online ? v.state : "offline"}
        {typeof v.battery === "number" ? `, ${v.battery}% charged` : ""}.
      </p>
      <div className="hv-nums">
        <Num v={v.online ? v.state : "offline"} k="vacuum" tone={v.online ? undefined : "warn"} />
        <Num v={pct(v.battery)} unit="%" k="battery" />
        <Num v={v.alerts.length} k={v.alerts.length ? v.alerts.join(", ") : "alerts"} tone={v.alerts.length ? "warn" : "ok"} />
        <Num v={rooms.length} k="rooms on its map" />
      </div>
      {cleaning && <HallLive device={v.id} battery={v.battery} />}
      <div className="hv-grid is-hall">
        <Card title="Where to send it" tag={pick.length ? `${pick.length} picked` : "tap rooms"} wide>
          {rooms.length ? (
            <>
              {plan ? <RoomMap plan={plan} names={rooms} picked={pick} onToggle={toggle} cleaning={cleaning} disabled={off} /> : null}
              {chips.length > 0 && (
                <div className="hv-chips" role="group" aria-label={plan ? "More rooms on the vacuum's map" : "Rooms on the vacuum's map"}>
                  {chips.map((r) => (
                    <button key={r} type="button" className="hv-chip" aria-pressed={pick.includes(r)} onClick={() => toggle(r)}>
                      {r}
                    </button>
                  ))}
                </div>
              )}
              <VacuumModes suction={suction} water={water} onSuction={setSuction} onWater={setWater} />
              <button type="button" className="hv-btn is-pri" disabled={off || !pick.length} onClick={() => void act("vacuum.rooms", v.id, pick, mode).then((ok) => ok && setPick([]))}>
                {pick.length ? `Clean ${pick.join(", ")}` : "Pick rooms to clean"}
              </button>
            </>
          ) : (
            <Waiting>The vacuum hasn't sent its map's room names yet.</Waiting>
          )}
          <Said />
        </Card>
        <Plate title="Vacuum" num={v.online ? v.state : "offline"} tone={v.online ? undefined : "wait"} stage={<VacuumStage d={v} />}>
          <p className="hv-row">
            <span className="hv-k">Battery</span> <Bar v={v.battery} warn={(v.battery ?? 100) < 15} /> <span>{pct(v.battery)}%</span>
          </p>
          <p className="hv-note">
            <Private>{v.model || "Roborock"}</Private>
          </p>
          {v.alerts.length > 0 && (
            <div className="hv-plChips">
              {v.alerts.map((a) => (
                <span key={a} className="is-warn">
                  {a}
                </span>
              ))}
            </div>
          )}
          <div className="hv-btns">
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
        </Plate>
      </div>
    </>
  );
}

/* ── Pets ── */

export function PetsTab({ devices, petlibro, whisker }: { devices: DeviceReading[] | null; petlibro: string; whisker: string }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const dry = find(devices, "dry-feeder"), wet = find(devices, "wet-feeder"), water = find(devices, "fountain"), litter = find(devices, "litter");
  // A moment of motion when an action lands (#718): the kibble falls, the globe turns.
  const [fed, flashFed] = useFlash(4000);
  const [cycled, flashCycled] = useFlash(9000);
  // The due list says when the filter and the clean are due (#685), so their alerts aren't said twice.
  const waterAlerts = water?.alerts.filter((a) => !(a === "filter due" && water.filterDays !== undefined) && !(a === "needs a clean" && water.cleanDays !== undefined)) ?? [];
  const say = [
    dry?.foodLow && "Dry food is low",
    water && typeof water.water === "number" && water.water < 25 && "the fountain is low",
    water && (water.filterDays ?? 1) <= 0 && "the fountain's filter is due",
    litter && (litter.drawer ?? 0) >= 85 && "the drawer is full",
  ].filter(Boolean) as string[];
  return (
    <>
      <p className="hv-say">{say.length ? `${say.join(", ")}.` : dry || wet || water || litter ? `Last fed ${ago(dry?.lastFed ?? wet?.lastFed)}. All good.` : "The cat's things aren't connected yet."}</p>
      <div className="hv-nums">
        <Num v={dry ? (dry.foodLow ? "Low" : "OK") : "–"} k="dry food" tone={dry ? (dry.foodLow ? "warn" : "ok") : "wait"} />
        <Num v={ago(dry?.lastFed ?? wet?.lastFed)} k="last fed" />
        <Num v={water ? pct(water.water) : "–"} unit={water ? "%" : undefined} k="fountain water" tone={water ? undefined : "wait"} />
        <Num v={litter ? litter.state : "–"} k="Litter-Robot" tone={litter ? (litter.state === "ready" ? "ok" : undefined) : "wait"} />
      </div>
      {/* Each device on its own plate (#766, A1 Plates): the render large, the reading drawn where it lives on it. */}
      <div className="hv-plates is-compact">
        <Plate
          title="Dry feeder"
          num={dry ? (!dry.online ? "offline" : dry.foodLow ? "Low" : "OK") : "–"}
          tone={dry ? (!dry.online ? "wait" : dry.foodLow ? "warn" : "ok") : "wait"}
          stage={<DryStage d={dry} feeding={fed} />}
        >
          {dry ? (
            <>
              <p className="hv-note">
                Last fed {ago(dry.lastFed)} · {dry.manualToday ?? 0} of {dry.manualCap ?? 2} extra portions today
              </p>
              <DryDay d={dry} />
              <button type="button" className="hv-btn" disabled={!dry.online || busy !== null || (dry.manualToday ?? 0) >= (dry.manualCap ?? 2)} onClick={() => void act("feeder.feed", dry.id).then((ok) => ok && flashFed())}>
                Feed 1 portion
              </button>
            </>
          ) : (
            <Waiting>{waitFor("Petlibro", petlibro)}</Waiting>
          )}
        </Plate>
        <Plate title="Wet feeder" num={wet && frontBowl(wet) ? `Bowl ${frontBowl(wet)}` : "–"} tone={wet ? (wet.online ? undefined : "wait") : "wait"} stage={<WetStage d={wet} />}>
          {wet ? (
            <>
              <p className="hv-row">
                <span data-testid="wet-state">{!wet.online ? "offline" : wet.closesAt ? `Open, closes at ${closeClock(wet.closesAt)}` : wet.state}</span>
              </p>
              <p className="hv-note">
                Last opened {ago(wet.lastFed)} · {wet.manualToday ?? 0} of {wet.manualCap ?? 2} today
              </p>
              <WetDay d={wet} />
              {/* An opening from here closes itself after two hours (#713): Open again restarts them, Close shuts it now. */}
              <div className="hv-btns">
                <button
                  type="button"
                  className="hv-btn"
                  disabled={!wet.online || busy !== null || (wet.closesAt ? false : wet.state === "lid open" || (wet.manualToday ?? 0) >= (wet.manualCap ?? 2))}
                  onClick={() => void act("wet.open", wet.id)}
                >
                  {wet.closesAt ? "Two more hours" : "Open for 2 hours"}
                </button>
                {wet.state === "lid open" && (
                  <button type="button" className="hv-btn" disabled={!wet.online || busy !== null} onClick={() => void act("wet.close", wet.id)}>
                    Close
                  </button>
                )}
              </div>
            </>
          ) : (
            <Waiting>{waitFor("Petlibro", petlibro)}</Waiting>
          )}
        </Plate>
        <Plate
          title="Water fountain"
          num={water ? pct(water.water) : "–"}
          unit={water && typeof water.water === "number" ? "%" : undefined}
          tone={water ? (water.online ? (typeof water.water === "number" && water.water < 25 ? "warn" : undefined) : "wait") : "wait"}
          stage={<FountainStage d={water} />}
        >
          {water ? (
            <>
              <p className="hv-note">{water.online ? (flowing(water) ? "Flowing" : water.state) : "offline"}</p>
              {water.filterDays === undefined && (
                <p className="hv-row">
                  <span className="hv-k">Filter</span> <Bar v={water.filter} warn={(water.filter ?? 100) < 15} /> <span>{pct(water.filter)}%</span>
                </p>
              )}
              <FountainDay d={water} />
              {waterAlerts.length > 0 && <p className="hv-note is-warn">{waterAlerts.join(", ")}</p>}
            </>
          ) : (
            <Waiting>{waitFor("Petlibro", petlibro)}</Waiting>
          )}
        </Plate>
        <Plate
          title="Litter-Robot"
          num={litter ? (litter.online ? litterWord(litter.state) : "offline") : "–"}
          tone={litter ? (!litter.online ? "wait" : (litter.drawer ?? 0) >= 85 ? "warn" : litter.state === "ready" ? "ok" : undefined) : "wait"}
          stage={<LitterStage d={litter} flash={cycled} />}
        >
          {litter ? (
            <>
              <p className="hv-row">
                <span className="hv-k">Drawer</span> <Bar v={litter.drawer} warn={(litter.drawer ?? 0) >= 85} /> <span>{pct(litter.drawer)}%</span>
              </p>
              <p className="hv-row">
                <span className="hv-k">Litter</span> <Bar v={litter.litter} warn={(litter.litter ?? 100) < 20} /> <span>{pct(litter.litter)}%</span>
              </p>
              <p className="hv-note">Last visit {ago(litter.lastUse)}</p>
              {litter.alerts.length > 0 && <p className="hv-note is-warn">{litter.alerts.join(", ")}</p>}
              <button type="button" className="hv-btn" disabled={!litter.online || busy !== null || litter.state !== "ready"} onClick={() => void act("litter.clean", litter.id).then((ok) => ok && flashCycled())}>
                Clean now
              </button>
            </>
          ) : (
            <Waiting>{waitFor("Whisker", whisker)}</Waiting>
          )}
        </Plate>
      </div>
      <Said />
    </>
  );
}

/* ── Gym: its own app (#660), in GymTab.tsx ── */

/* ── A room of its own ── */

export function RoomTab({ room, lit, plan, devices }: { room: PlanRoom; lit: Lit | undefined; plan: HavenPlan; devices: DeviceReading[] | null }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const v = find(devices, "vacuum");
  const known = v?.rooms?.find((r) => r.toLowerCase() === (room.vacuum ?? room.name).toLowerCase());
  void plan;
  return (
    <>
      <p className="hv-say">{lit ? lit.why.join(", ") : "Quiet. Nothing here needs you."}</p>
      <div className="hv-grid">
        <Card title={room.name} tag={lit ? (lit.needs ? "needs you" : "lit") : "quiet"} wide>
          {v && known ? (
            <>
              <p className="hv-note">The vacuum knows this room as "{known}".</p>
              <button type="button" className="hv-btn is-pri" disabled={!v.online || busy !== null} onClick={() => void act("vacuum.rooms", v.id, [known])}>
                Vacuum {room.name}
              </button>
              <Said />
            </>
          ) : (
            <p className="hv-note">Nothing connected is in this room yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
