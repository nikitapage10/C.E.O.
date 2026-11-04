import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeskAuth } from "../signin.ts";
import { startHome, useHome, type Vendor, type VendorState } from "../homeDevices.ts";
import { loadCounts, loadKitchen, tickItem, type KitchenItem } from "../haven.ts";
import { openTodos, useTodos } from "../todos/todos.ts";
import { climateOf, litRooms, loadPlan, PLAN_NOTE, savePlan, summaryOf, tabOf, type PlanLoad, type Spot, type Tab } from "./data.ts";
import { HallTab, KitchenTab, PetsTab, RoomTab, TAB_NAME } from "./panels.tsx";
import { GymTab } from "./GymTab.tsx";
import { ClimatePop } from "./ClimatePop.tsx";
import { Plinth } from "./Plinth.tsx";
import { gaugesOf, type GaugeId } from "./plinth.ts";
import type { House, ThreadState } from "./house.ts";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "./haven.css";

/**
 * The Haven (#616): home and health on the Desk. Nikita's round-6 pick: the house in 3D, night-lit behind frosted
 * glass, where only the rooms with something going on light up, with the house-wide readings on the instrument plinth
 * in the dark to its lower right (#680), a thread of nanites from each gauge's lamp to its device. Tap a room and the camera flies in (300 ms), the house blurs behind,
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
  const [counts, setCounts] = useState<{ kitchen: number; todos: number; gym: { perWeek: number; doneThisWeek: number } | null } | null>(null);
  const [plan, setPlan] = useState<PlanLoad>({ state: "idle" });
  const [open, setOpen] = useState<Open>(null);
  const [gl, setGl] = useState<"idle" | "on" | "none">("idle");
  // Sent from the Kitchen chip or Controls (?open=kitchen): the Kitchen opens (#664).
  const houseHost = useRef<HTMLDivElement>(null);
  const labelHost = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const house = useRef<House | null>(null);
  const lamps = useRef<Partial<Record<GaugeId, HTMLElement | null>>>({});
  const strip = useRef<HTMLElement>(null);

  useEffect(() => startHome(), []);
  useEffect(() => {
    if (!signedIn) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("open") !== "kitchen") return;
    setOpen({ tab: "kitchen" });
    q.delete("open");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${q.size ? `?${q}` : ""}${window.location.hash}`);
  }, [signedIn]);
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
      else setItems(null);
      // The status view's counts: all there is signed out, and the Gym's sessions (#660) signed in too.
      void loadCounts().then((l) => setCounts(l.state === "ready" && l.view.ready ? { kitchen: l.view.kitchen.open, todos: l.view.todos, gym: l.view.gym ?? null } : null));
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
  const hasGym = !!counts?.gym;
  const lit = useMemo(() => (thePlan ? litRooms(thePlan, { devices, kitchenOpen, climate, gym: hasGym, now: Date.now() }) : {}), [thePlan, devices, kitchenOpen, climate, hasGym]);
  // The thermostat control (#671): from the Climate card or the Nest's marker, passkey only.
  const thermo = signedIn ? (devices?.find((d) => d.kind === "thermostat") ?? null) : null;
  const [climateOpen, setClimateOpen] = useState(false);
  const closeClimate = useCallback(() => setClimateOpen(false), []);
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
        const head = houseHost.current.parentElement?.querySelector(".hv-head");
        const clearTop = () => (head && houseHost.current ? head.getBoundingClientRect().bottom - houseHost.current.getBoundingClientRect().top : 0);
        const host = houseHost.current;
        // The strip's box and each lamp, in the house's own frame (#680): the fit keeps the rooms clear of the strip,
        // and each thread starts at its lamp (none for a gauge scrolled out of sight on a phone).
        const keepClear = () => {
          const s = strip.current?.getBoundingClientRect(), h = host.getBoundingClientRect();
          return s && s.width ? { x: s.left - h.left, y: s.top - h.top, w: s.width, h: s.height } : null;
        };
        const lampAt = (id: GaugeId): [number, number] | null => {
          const el = lamps.current[id], s = strip.current?.getBoundingClientRect();
          if (!el || !s) return null;
          const b = el.getBoundingClientRect(), h = host.getBoundingClientRect();
          const x = b.left + b.width / 2;
          if (!b.width || x < s.left + 4 || x > s.right - 4) return null;
          return [x - h.left, b.top + b.height / 2 - h.top];
        };
        house.current = new House(host, labelHost.current, thePlan, { reduce: reduce(), onPick, onAway: setAway, clearTop, keepClear, lampAt, onSpot: (spot) => spot === "thermostat" && setClimateOpen(true) });
        setGl("on");
      } catch {
        setGl("none");
      }
    });
    return () => {
      gone = true;
      house.current?.dispose();
      house.current = null;
      setAway(false);
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

  /* ── the instrument plinth (#680): the gauges, and their threads into the house ── */
  const gauges = useMemo(
    () => gaugesOf({ signedIn, loading: homeLoad === "idle", vendors, devices: pub?.devices ?? [], climate, kitchenOpen, gym: counts?.gym ?? null, todos: todoCount }),
    [signedIn, homeLoad, vendors, pub, climate, kitchenOpen, counts, todoCount],
  );
  useEffect(() => {
    const busy = (id: GaugeId, n: number | null) => (n === null ? 0 : Math.min(1, 0.15 + n / 8));
    const level: Record<GaugeId, number> = {
      climate: climate.state === "live" && climate.running ? 0.8 : 0.3,
      roborock: devices?.some((d) => d.kind === "vacuum" && /clean/i.test(d.state)) ? 0.9 : 0.4,
      petlibro: 0.4,
      whisker: 0.4,
      kitchen: busy("kitchen", kitchenOpen),
      gym: counts?.gym ? Math.min(1, 0.2 + counts.gym.doneThisWeek / Math.max(1, counts.gym.perWeek)) : 0,
      todos: busy("todos", todoCount),
    };
    const list: ThreadState[] = gauges.map((g) => ({ id: g.id, tone: g.tone, level: level[g.id] }));
    house.current?.setThreads(list);
  }, [gauges, climate, devices, kitchenOpen, counts, todoCount, gl]);
  // The strip's size changes with its readings and the page's width: fit the house round it again.
  useEffect(() => {
    const el = strip.current;
    const wrap = el?.parentElement;
    if (!el || !wrap) return;
    const ro = new ResizeObserver(() => {
      wrap.style.setProperty("--hv-ph", `${Math.round(el.offsetHeight)}px`);
      house.current?.refit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [gl]);
  const lamp = useCallback((id: GaugeId) => (el: HTMLElement | null) => void (lamps.current[id] = el), []);
  const toggleClimate = useCallback(() => setClimateOpen((v) => !v), []);
  const openGauge = useCallback((id: GaugeId) => (id === "kitchen" || id === "gym") && setOpen({ tab: id }), []);
  const canOpen = useCallback((id: GaugeId) => signedIn && (id === "kitchen" || id === "gym"), [signedIn]);
  const touch = useCallback(() => house.current?.touch(), []);

  const tick = (item: KitchenItem) => {
    const done = !item.done;
    setItems((cur) => cur?.map((i) => (i.id === item.id ? { ...i, done } : i)) ?? cur);
    void tickItem(item.id, done).then((r) => !r.ok && loadKitchen().then((l) => l.state === "ready" && setItems(l.view.items)));
  };
  // Remove with Undo (#673): the Kitchen tab hides the item at once and keeps Undo; these keep the list in step.
  const drop = (item: KitchenItem) => setItems((cur) => cur?.filter((i) => i.id !== item.id) ?? cur);
  const reread = () => void loadKitchen().then((l) => l.state === "ready" && setItems(l.view.items));

  const summary = thePlan ? summaryOf(lit, thePlan) : signedIn ? "The house, the pets and the kitchen, from what's connected." : "Counts and states only. Sign in to see the house.";
  const openRoom = open && "room" in open ? thePlan?.rooms.find((r) => r.id === open.room) : undefined;
  const openTab: Tab | null = open && "tab" in open ? open.tab : openRoom && thePlan ? tabOf(thePlan, openRoom) : null;
  const sheetTitle = openTab ? TAB_NAME[openTab] : (openRoom?.name ?? "");

  return (
    <div className="hv fl-page" data-room="haven" data-open={open ? "" : undefined} style={{ ["--fl-accent" as string]: ACCENT }}>
      <section className="hv-stage fl-stage" aria-label="The house">
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
          {gl === "on" && (
            <div className="hv-hintRow">
              <p className="hv-hint">Drag to turn · pinch or scroll to zoom · tap a room</p>
              {away && (
                <button type="button" className="hv-reset" onClick={() => house.current?.resetView()}>
                  Reset view
                </button>
              )}
            </div>
          )}
          <Plinth gauges={gauges} thermo={thermo} climateOpen={climateOpen} onClimate={toggleClimate} onOpen={openGauge} canOpen={canOpen} lamp={lamp} onScroll={touch} stripRef={strip}>
            {climateOpen && thermo && !open && <ClimatePop d={thermo} onClose={closeClimate} />}
          </Plinth>
        </div>

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
              <KitchenTab items={items} onTick={tick} onDrop={drop} onReread={reread} />
            ) : openTab === "hall" ? (
              <HallTab devices={devices} connected={vendors.roborock !== "waiting"} room={openRoom} />
            ) : openTab === "pets" ? (
              <PetsTab devices={devices} petlibro={stateWord[vendors.petlibro]} whisker={stateWord[vendors.whisker]} />
            ) : openTab === "gym" ? (
              <GymTab onCounts={(gym) => setCounts((c) => (c ? { ...c, gym } : c))} />
            ) : openRoom && thePlan ? (
              <RoomTab room={openRoom} lit={lit[openRoom.id]} plan={thePlan} devices={devices} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
