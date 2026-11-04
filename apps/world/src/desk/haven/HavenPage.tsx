import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { converge, useFlow, type FlowLayoutFn, type FlowLine } from "../flow/index.ts";
import { BAD, OK, WHITE } from "../wvCanvas.ts";
import { useDeskAuth } from "../signin.ts";
import { Private } from "../Private.tsx";
import { startHome, useHome, VENDOR_NAME, VENDORS, type Vendor, type VendorState } from "../homeDevices.ts";
import { loadCounts, loadKitchen, tickItem, type KitchenItem } from "../haven.ts";
import { openTodos, useTodos } from "../todos/todos.ts";
import { climateOf, litRooms, loadPlan, PLAN_NOTE, savePlan, summaryOf, tabOf, type PlanLoad, type Spot, type Tab } from "./data.ts";
import { GymTab, HallTab, KitchenTab, PetsTab, RoomTab, TAB_NAME } from "./panels.tsx";
import type { House } from "./house.ts";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "./haven.css";

/**
 * The Haven (#616): home and health on the Desk. Nikita's round-6 pick: the house in 3D, night-lit behind frosted
 * glass, where only the rooms with something going on light up, with the Desk's flow lines carrying each source's real
 * activity in from the house-wide strip beside it. Tap a room and the camera flies in (300 ms), the house blurs behind,
 * and the room's content opens over it (Kitchen, Hall, Pets, Gym, or the room's own sheet).
 *
 * Privacy: the floor plan lives in the private store and is read only by a passkey session (/api/haven-plan); signed
 * out the Haven shows counts and states only, with no map. Health, pantry and device details stay behind the passkey.
 * The 3D chunk (three, from the Lattice's own chunk) loads only when there is a plan to draw.
 */

const ACCENT = "240,201,135";
const TABS: Tab[] = ["kitchen", "hall", "pets", "gym"];

const reduce = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const dayWord = (d = new Date()) => `${d.toLocaleDateString("en-US", { weekday: "long" })} ${d.getHours() < 12 ? "morning" : d.getHours() < 17 ? "afternoon" : "evening"}`;
const stateWord: Record<VendorState, string> = { live: "live", down: "down", waiting: "waiting" };

type Open = { tab: Tab } | { room: string } | null;

function PlanImport({ onSaved }: { onSaved: (p: PlanLoad) => void }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setNote(PLAN_NOTE["bad-plan"]!);
      return;
    }
    setBusy(true);
    const got = await savePlan(parsed);
    setBusy(false);
    if (got.ok) {
      setText("");
      onSaved({ state: "ready", plan: got.plan });
    } else setNote(PLAN_NOTE[got.error] ?? PLAN_NOTE.failed!);
  };
  return (
    <details className="hv-import">
      <summary>Import your floor plan</summary>
      <p className="hv-note">Paste the plan's JSON, or pick its file. It's kept in the private store and drawn only for your passkey.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} spellCheck={false} aria-label="Floor plan JSON" placeholder='{ "v": 1, "w": …, "rooms": [ … ] }' />
      <div className="hv-btns">
        <button type="button" className="hv-btn is-pri" disabled={busy || !text.trim()} onClick={() => void save(text)}>
          {busy ? "Saving…" : "Save the plan"}
        </button>
        <label className="hv-btn">
          Pick a file
          <input type="file" accept="application/json,.json" hidden onChange={(e) => void e.target.files?.[0]?.text().then(save)} />
        </label>
      </div>
      {note && (
        <p className="hv-note is-warn" role="status">
          {note}
        </p>
      )}
    </details>
  );
}

export function Haven() {
  const auth = useDeskAuth((s) => s.auth.status);
  const signedIn = auth === "in";
  const home = useHome((s) => s.view);
  const pub = useHome((s) => s.pub);
  const homeLoad = useHome((s) => s.load);
  const todos = useTodos((s) => s.state);
  const [items, setItems] = useState<KitchenItem[] | null>(null);
  const [counts, setCounts] = useState<{ kitchen: number; todos: number } | null>(null);
  const [plan, setPlan] = useState<PlanLoad>({ state: "idle" });
  const [open, setOpen] = useState<Open>(null);
  const [gl, setGl] = useState<"idle" | "on" | "none">("idle");
  const houseHost = useRef<HTMLDivElement>(null);
  const labelHost = useRef<HTMLDivElement>(null);
  const house = useRef<House | null>(null);
  const utilRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => startHome(), []);
  useEffect(() => {
    if (auth === "checking") return;
    void useTodos.getState().refresh();
    if (signedIn) {
      void loadPlan().then((p) => (p.state === "out" ? useDeskAuth.getState().lost() : setPlan(p)));
    } else setPlan({ state: "idle" });
    const read = () => {
      if (signedIn)
        void loadKitchen().then((l) => {
          if (l.state === "ready") setItems(l.view.items);
          else if (l.state === "out") useDeskAuth.getState().lost();
        });
      else {
        setItems(null);
        void loadCounts().then((l) => setCounts(l.state === "ready" && l.view.ready ? { kitchen: l.view.kitchen.open, todos: l.view.todos } : null));
      }
    };
    read();
    const t = window.setInterval(read, 120_000);
    return () => window.clearInterval(t);
  }, [auth, signedIn]);

  const devices = signedIn ? (home?.devices ?? null) : null;
  // The Nest (#637): live from the thermostat's reading once it's connected; waiting before, and always signed out.
  const climate = useMemo(() => climateOf(devices), [devices]);
  const kitchenOpen = signedIn ? (items ? items.filter((i) => !i.done).length : null) : (counts?.kitchen ?? null);
  const openList = useMemo(() => (signedIn ? openTodos(todos, Date.now()) : []), [todos, signedIn]);
  const todoCount = signedIn ? openList.length : (counts?.todos ?? null);
  const thePlan = plan.state === "ready" ? plan.plan : null;
  const lit = useMemo(() => (thePlan ? litRooms(thePlan, { devices, kitchenOpen, climate, now: Date.now() }) : {}), [thePlan, devices, kitchenOpen, climate]);
  const vendors: Record<Vendor, VendorState> = useMemo(() => (signedIn ? home?.vendors : pub?.vendors) ?? { roborock: "waiting", petlibro: "waiting", whisker: "waiting", nest: "waiting" }, [signedIn, home, pub]);

  /* ── the 3D house, only with a plan ── */
  const onPick = useCallback((id: string | null) => {
    if (id) setOpen({ room: id });
  }, []);
  useEffect(() => {
    if (!thePlan || !houseHost.current || !labelHost.current) return;
    let gone = false;
    void import("./house.ts").then(({ House, canDraw3D }) => {
      if (gone || !houseHost.current || !labelHost.current) return;
      if (!canDraw3D()) return setGl("none");
      try {
        house.current = new House(houseHost.current, labelHost.current, thePlan, { reduce: reduce(), onPick });
        setGl("on");
      } catch {
        setGl("none");
      }
    });
    return () => {
      gone = true;
      house.current?.dispose();
      house.current = null;
    };
  }, [thePlan, onPick]);

  // What each room's label and each device's tag say, from the readings.
  useEffect(() => {
    const h = house.current;
    if (!h || !thePlan) return;
    const facts: Record<string, { fact?: string }> = {};
    for (const [id, l] of Object.entries(lit)) facts[id] = { fact: l.why[0] };
    const tags: Partial<Record<Spot, string>> = {};
    for (const d of devices ?? []) {
      const spot = d.kind as Spot;
      if (d.kind === "vacuum") tags[spot] = d.online ? `${d.state}${typeof d.battery === "number" ? ` · ${d.battery}%` : ""}` : "offline";
      else if (d.kind === "litter") tags[spot] = d.online ? d.state : "offline";
      else if (d.kind === "fountain") tags[spot] = typeof d.water === "number" ? `${d.water}%` : d.state;
      else if (d.kind === "dry-feeder" && d.foodLow) tags[spot] = "food low";
    }
    tags.thermostat = climate.state === "live" ? `${climate.inside}°F${climate.target !== null ? ` → ${climate.target}°F` : ""}` : "Climate: waiting";
    h.setLit(lit, facts, tags);
  }, [lit, devices, thePlan, gl, climate]);

  // Opening a room flies the camera in and lays the house behind the content; closing flies back out.
  const roomId = open && "room" in open ? open.room : open && "tab" in open && thePlan ? (thePlan.rooms.find((r) => tabOf(thePlan, r) === open.tab)?.id ?? null) : null;
  useEffect(() => {
    house.current?.focus(roomId);
    house.current?.setBackdrop(open !== null);
  }, [roomId, open, gl]);
  // The sheet opens below the Desk's nav, whatever height the nav wraps to.
  const [top, setTop] = useState(60);
  useEffect(() => {
    if (!open) return;
    // The house behind the sheet is at the top of the page: bring it into view, then measure the nav there.
    window.scrollTo({ top: 0 });
    setTop(Math.max(0, Math.round(document.querySelector(".wv-nav")?.getBoundingClientRect().bottom ?? 0)));
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);

  /* ── the flow lines: each source's real activity, from the house-wide strip into the house ── */
  const sources = useMemo(() => {
    const vend = (v: Vendor): { waiting: boolean; density: number; rgb?: string } => (vendors[v] === "live" ? { waiting: false, density: 0.55 } : vendors[v] === "down" ? { waiting: false, density: 0.15, rgb: BAD } : { waiting: true, density: 0 });
    return [
      { id: "climate", waiting: climate.state !== "live", density: climate.state === "live" ? (climate.running ? 0.55 : 0.2) : 0 },
      { id: "devices-roborock", ...vend("roborock") },
      { id: "devices-petlibro", ...vend("petlibro") },
      { id: "devices-whisker", ...vend("whisker") },
      { id: "kitchen", waiting: kitchenOpen === null, density: kitchenOpen ? Math.min(1, 0.2 + kitchenOpen / 10) : 0.08, rgb: OK },
      { id: "todos", waiting: todoCount === null, density: todoCount ? Math.min(1, 0.2 + todoCount / 10) : 0.08, rgb: WHITE },
    ];
  }, [vendors, kitchenOpen, todoCount, climate]);
  const layout = useCallback<FlowLayoutFn>(
    ({ W, H, phone, rel }) => {
      const stage = houseHost.current ? rel(houseHost.current) : { x: 0, y: 0, w: W, h: H };
      const to: [number, number] = [stage.x + stage.w / 2, stage.y + stage.h / 2];
      const from = sources.map((s) => {
        const el = utilRefs.current[s.id];
        if (!el) return [phone ? W / 2 : W - 20, H - 20] as [number, number];
        const b = rel(el);
        return (phone ? [b.x + b.w / 2, b.y] : [b.x, b.y + b.h / 2]) as [number, number];
      });
      const paths = converge(from, to, { trunk: 0.3 });
      const lines: FlowLine[] = sources.map((s, i) => ({ id: s.id, path: paths[i]!, density: s.density, waiting: s.waiting, rate: s.waiting ? 12 : 28 + s.density * 40, ...(s.rgb && { rgb: s.rgb }) }));
      return { lines };
    },
    [sources],
  );
  const { cv, bind } = useFlow(layout, { accent: ACCENT, ground: true, room: null });

  const tick = (item: KitchenItem) => {
    const done = !item.done;
    setItems((cur) => cur?.map((i) => (i.id === item.id ? { ...i, done } : i)) ?? cur);
    void tickItem(item.id, done).then((r) => !r.ok && loadKitchen().then((l) => l.state === "ready" && setItems(l.view.items)));
  };

  const summary = thePlan ? summaryOf(lit, thePlan) : signedIn ? "The house, the pets and the kitchen, from what's connected." : "Counts and states only. Sign in to see the house.";
  const util = (id: string) => (el: HTMLElement | null) => void (utilRefs.current[id] = el);
  const openRoom = open && "room" in open ? thePlan?.rooms.find((r) => r.id === open.room) : undefined;
  const openTab: Tab | null = open && "tab" in open ? open.tab : openRoom && thePlan ? tabOf(thePlan, openRoom) : null;
  const sheetTitle = openTab ? TAB_NAME[openTab] : (openRoom?.name ?? "");

  return (
    <div className="hv fl-page" data-room="haven" data-open={open ? "" : undefined} style={{ ["--fl-accent" as string]: ACCENT }}>
      <section className="hv-stage fl-stage" {...bind} aria-label="The house">
        <canvas ref={cv} className="fl-cv" aria-hidden="true" />
        <div className="hv-houseWrap">
          <div className="hv-house" ref={houseHost} data-gl={gl} />
          <div className="hv-labs" ref={labelHost} aria-hidden="true" />
          <header className="hv-head">
            <p className="fl-eyb">
              <span>Haven</span>
              <i />
              {dayWord()}
            </p>
            <h1 className="hv-h1">The Haven</h1>
            <p className="hv-sum">{summary}</p>
          </header>
          {!signedIn && (
            <div className="hv-out">
              <p>The house draws only for your passkey.</p>
            </div>
          )}
          {signedIn && plan.state === "waiting" && (
            <div className="hv-out">
              <p className="hv-wait">
                <i aria-hidden="true" />
                Waiting for your floor plan.
              </p>
              <PlanImport onSaved={setPlan} />
            </div>
          )}
          {signedIn && plan.state === "failed" && (
            <div className="hv-out">
              <p>The floor plan didn't load. It'll try again when you come back.</p>
            </div>
          )}
          {gl === "none" && (
            <div className="hv-out">
              <p>This browser can't draw the house in 3D. Everything else is below.</p>
            </div>
          )}
          {gl === "on" && <p className="hv-hint">Drag to turn · pinch or scroll to zoom · tap a room</p>}
        </div>

        <aside className="hv-util" aria-label="House-wide">
          <h2 className="hv-utilH">House-wide</h2>
          <div className="hv-u" ref={util("climate")}>
            <span className="hv-uk">Climate</span>
            {climate.state === "live" ? (
              <>
                <b className="hv-uv is-live">{climate.inside}°F</b>
                <span className="hv-un">{climate.mode === "off" ? "Off" : climate.mode === "eco" ? "Eco" : `${climate.running ? (climate.mode === "cool" ? "Cooling" : "Heating") : "Holding"}${climate.target !== null ? ` to ${climate.target}°F` : ""}`}</span>
              </>
            ) : (
              <>
                <b className={`hv-uv is-${vendors.nest === "waiting" ? "wait" : vendors.nest}`}>{vendors.nest === "live" ? "Live" : vendors.nest === "down" ? "Down" : "Waiting"}</b>
                <span className="hv-un">{vendors.nest === "waiting" ? "The Nest isn't connected yet (Today's Home chip). Then the climate lights the living room." : signedIn ? "The thermostat" : "The thermostat; the temperature shows signed in."}</span>
              </>
            )}
          </div>
          {VENDORS.filter((v) => v !== "nest").map((v) => (
            <div className="hv-u" key={v} ref={util(`devices-${v}`)}>
              <span className="hv-uk">{VENDOR_NAME[v]}</span>
              <b className={`hv-uv is-${vendors[v]}`}>{homeLoad === "idle" ? "…" : stateWord[vendors[v]]}</b>
              <span className="hv-un">{v === "roborock" ? "The vacuum" : v === "petlibro" ? "Feeders and fountain" : "The Litter-Robot"}</span>
            </div>
          ))}
          <button type="button" className="hv-u is-btn" ref={util("kitchen")} disabled={!signedIn} onClick={() => setOpen({ tab: "kitchen" })}>
            <span className="hv-uk">Kitchen list</span>
            <b className="hv-uv">{kitchenOpen ?? "–"}</b>
            <span className="hv-un">to get</span>
          </button>
          <a className="hv-u is-btn" ref={util("todos")} href="/">
            <span className="hv-uk">To-dos</span>
            <b className="hv-uv">{todoCount ?? "–"}</b>
            <span className="hv-un">
              {openList.length ? (
                <Private>{openList
                  .slice(0, 2)
                  .map((t) => t.text)
                  .join(" · ")}</Private>
              ) : (
                "open, on Today"
              )}
            </span>
          </a>
        </aside>
      </section>

      {signedIn && (
        <nav className="hv-tabs" aria-label="Haven rooms">
          {TABS.map((t) => (
            <button key={t} type="button" className="hv-tab" aria-pressed={openTab === t} onClick={() => setOpen({ tab: t })}>
              {TAB_NAME[t]}
            </button>
          ))}
        </nav>
      )}

      {open && signedIn && (
        <div className="hv-sheet" role="dialog" aria-modal="false" aria-label={sheetTitle} style={{ ["--hv-top" as string]: `${top}px` }}>
          <div className="hv-sheetIn">
            <div className="hv-sheetBar">
              <button type="button" className="hv-back" onClick={() => setOpen(null)}>
                <span aria-hidden="true">‹</span> Haven
              </button>
              <div className="hv-sheetTabs" role="group" aria-label="Rooms">
                {TABS.map((t) => (
                  <button key={t} type="button" className="hv-tab" aria-pressed={openTab === t} onClick={() => setOpen({ tab: t })}>
                    {TAB_NAME[t]}
                  </button>
                ))}
              </div>
            </div>
            <p className="hv-eyb">Haven · {sheetTitle}</p>
            <h2 className="hv-h2">{sheetTitle}</h2>
            {openTab === "kitchen" ? (
              <KitchenTab items={items} onTick={tick} />
            ) : openTab === "hall" ? (
              <HallTab devices={devices} connected={vendors.roborock !== "waiting"} room={openRoom} />
            ) : openTab === "pets" ? (
              <PetsTab devices={devices} petlibro={stateWord[vendors.petlibro]} whisker={stateWord[vendors.whisker]} />
            ) : openTab === "gym" ? (
              <GymTab />
            ) : openRoom && thePlan ? (
              <RoomTab room={openRoom} lit={lit[openRoom.id]} plan={thePlan} devices={devices} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
