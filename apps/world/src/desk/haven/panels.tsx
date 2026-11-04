import { useEffect, useRef, useState, type ReactNode } from "react";
import { Private } from "../Private.tsx";
import { useHome, type DeviceReading } from "../homeDevices.ts";
import { removeItem, undoRemoveItem, type KitchenItem } from "../haven.ts";
import type { HavenPlan, Lit, PlanRoom, Tab } from "./data.ts";
import { Groceries } from "./Groceries.tsx";

/**
 * The Haven's room content (#616), shown over the blurred house in the backdrop layout Nikita picked: Kitchen, Hall,
 * Pets and Gym, or a room's own sheet. Real readings only. A part with no source yet (the pantry, the meals) says it
 * is waiting, in plain type, and invents nothing.
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
  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  const kroger = useHome((s) => s.view?.links.kroger ?? s.pub?.links.kroger ?? "waiting");
  return (
    <>
      <p className="hv-say">{items === null ? "Reading the Kitchen list…" : open.length ? `${open.length} thing${open.length === 1 ? "" : "s"} on the list.` : "Nothing on the list."}</p>
      <div className="hv-nums">
        <Num v={items === null ? "–" : open.length} k="on the Kitchen list" />
        <Num v="–" k="pantry: waiting" tone="wait" />
        <Num v="–" k="meals: waiting" tone="wait" />
        <Num v={kroger === "live" ? "Live" : kroger === "down" ? "Down" : "–"} k={`King Soopers: ${kroger}`} tone={kroger === "live" ? "ok" : kroger === "down" ? "warn" : "wait"} />
      </div>
      <div className="hv-grid">
        <Card title="Shopping list" tag={`${open.length} open`}>
          {items === null ? (
            <Waiting>Reading the list…</Waiting>
          ) : items.length ? (
            <ul className="hv-list" aria-label="Kitchen list">
              {items.map((i) => (
                <li key={i.id} className={i.done ? "is-done" : ""}>
                  <label>
                    <input type="checkbox" checked={i.done} onChange={() => onTick(i)} />
                    <Private>{i.name}</Private>
                  </label>
                  <button type="button" className="hv-x" aria-label={`Remove ${i.name}`} onClick={() => remove(i)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hv-note">Empty. Say "Skippy, add garlic and lemons" on the phone.</p>
          )}
          {undo ? (
            <p className="hv-undo" role="status">
              <span>Removed.</span>
              <button type="button" onClick={takeBack}>
                Undo
              </button>
            </p>
          ) : null}
        </Card>
        <Card title="King Soopers" tag={kroger} wide>
          <Groceries listOpen={open.length} onRemove={(id) => byId.get(id) && remove(byId.get(id)!)} />
        </Card>
        <Card title="This week's meals" tag="waiting" wide>
          <Waiting>Waiting for a meal plan. Nothing is planned here until recipes are connected.</Waiting>
        </Card>
        <Card title="Pantry" tag="waiting">
          <Waiting>Waiting for a pantry source: what's in the fridge and on the shelf shows here once it's tracked.</Waiting>
        </Card>
      </div>
    </>
  );
}

/* ── Hall: the vacuum ── */

export function HallTab({ devices, connected, room }: { devices: DeviceReading[] | null; connected: boolean; room?: PlanRoom }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const v = find(devices, "vacuum");
  const [pick, setPick] = useState<string[]>([]);
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
      <div className="hv-grid">
        <Card title="Vacuum" tag={<Private>{v.model || "Roborock"}</Private>} wide>
          <div className="hv-btns">
            <button type="button" className="hv-btn" disabled={off} onClick={() => void act("vacuum.start", v.id)}>
              Start
            </button>
            <button type="button" className="hv-btn" disabled={off} onClick={() => void act("vacuum.pause", v.id)}>
              Pause
            </button>
            <button type="button" className="hv-btn" disabled={off} onClick={() => void act("vacuum.dock", v.id)}>
              Dock
            </button>
          </div>
          <h4 className="hv-k">Clean by room</h4>
          {rooms.length ? (
            <>
              <div className="hv-chips" role="group" aria-label="Rooms on the vacuum's map">
                {rooms.map((r) => (
                  <button key={r} type="button" className="hv-chip" aria-pressed={pick.includes(r) || room?.vacuum === r} onClick={() => toggle(r)}>
                    {r}
                  </button>
                ))}
              </div>
              <button type="button" className="hv-btn is-pri" disabled={off || !pick.length} onClick={() => void act("vacuum.rooms", v.id, pick).then((ok) => ok && setPick([]))}>
                {pick.length ? `Clean ${pick.join(", ")}` : "Pick rooms to clean"}
              </button>
            </>
          ) : (
            <Waiting>The vacuum hasn't sent its map's room names yet.</Waiting>
          )}
          <Said />
        </Card>
      </div>
    </>
  );
}

/* ── Pets ── */

export function PetsTab({ devices, petlibro, whisker }: { devices: DeviceReading[] | null; petlibro: string; whisker: string }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const dry = find(devices, "dry-feeder"), wet = find(devices, "wet-feeder"), water = find(devices, "fountain"), litter = find(devices, "litter");
  const say = [dry?.foodLow && "Dry food is low", water && typeof water.water === "number" && water.water < 25 && "the fountain is low", litter && (litter.drawer ?? 0) >= 85 && "the drawer is full"].filter(Boolean) as string[];
  return (
    <>
      <p className="hv-say">{say.length ? `${say.join(", ")}.` : dry || wet || water || litter ? `Last fed ${ago(dry?.lastFed ?? wet?.lastFed)}. All good.` : "The cat's things aren't connected yet."}</p>
      <div className="hv-nums">
        <Num v={dry ? (dry.foodLow ? "Low" : "OK") : "–"} k="dry food" tone={dry ? (dry.foodLow ? "warn" : "ok") : "wait"} />
        <Num v={ago(dry?.lastFed ?? wet?.lastFed)} k="last fed" />
        <Num v={water ? pct(water.water) : "–"} unit={water ? "%" : undefined} k="fountain water" tone={water ? undefined : "wait"} />
        <Num v={litter ? litter.state : "–"} k="Litter-Robot" tone={litter ? (litter.state === "ready" ? "ok" : undefined) : "wait"} />
      </div>
      <div className="hv-grid is-three">
        <Card title="Feeders" tag={petlibro}>
          {dry || wet ? (
            <>
              {dry && (
                <div className="hv-feed">
                  <p className="hv-row">
                    <b>Dry feeder</b> <span>{dry.online ? (dry.foodLow ? "food low" : "food ok") : "offline"}</span>
                  </p>
                  <p className="hv-note">
                    Last fed {ago(dry.lastFed)} · {dry.manualToday ?? 0} of {dry.manualCap ?? 2} extra portions today
                  </p>
                  <button type="button" className="hv-btn" disabled={!dry.online || busy !== null || (dry.manualToday ?? 0) >= (dry.manualCap ?? 2)} onClick={() => void act("feeder.feed", dry.id)}>
                    Feed 1 portion
                  </button>
                </div>
              )}
              {wet && (
                <div className="hv-feed">
                  <p className="hv-row">
                    <b>Wet feeder</b> <span>{wet.online ? wet.state : "offline"}</span>
                  </p>
                  <p className="hv-note">
                    Last opened {ago(wet.lastFed)} · {wet.manualToday ?? 0} of {wet.manualCap ?? 2} today
                  </p>
                  <button type="button" className="hv-btn" disabled={!wet.online || busy !== null || (wet.manualToday ?? 0) >= (wet.manualCap ?? 2)} onClick={() => void act("wet.open", wet.id)}>
                    Open the tray
                  </button>
                </div>
              )}
            </>
          ) : (
            <Waiting>Waiting for Petlibro.</Waiting>
          )}
        </Card>
        <Card title="Water fountain" tag={water ? (water.online ? "flowing" : "offline") : "waiting"}>
          {water ? (
            <>
              <div className="hv-water" style={{ ["--lvl" as string]: `${water.water ?? 0}%` }}>
                <b>{pct(water.water)}%</b>
              </div>
              <p className="hv-row">
                <span className="hv-k">Filter</span> <Bar v={water.filter} warn={(water.filter ?? 100) < 15} /> <span>{pct(water.filter)}%</span>
              </p>
              {water.alerts.length > 0 && <p className="hv-note is-warn">{water.alerts.join(", ")}</p>}
            </>
          ) : (
            <Waiting>Waiting for Petlibro.</Waiting>
          )}
        </Card>
        <Card title="Litter-Robot" tag={litter ? litter.state : whisker}>
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
              <button type="button" className="hv-btn" disabled={!litter.online || busy !== null || litter.state !== "ready"} onClick={() => void act("litter.clean", litter.id)}>
                Clean now
              </button>
            </>
          ) : (
            <Waiting>Waiting for Whisker.</Waiting>
          )}
        </Card>
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
