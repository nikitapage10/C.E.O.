import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { startHome, useHome, type Vendor, type VendorState } from "@ceo/desk/homeDevices.ts";
import { loadCounts, loadKitchen, tickItem, type KitchenItem } from "@ceo/desk/haven.ts";
import { openTodos, useTodos } from "@ceo/desk/todos/todos.ts";
import { climateOf, litRooms, loadPlan, PLAN_NOTE, savePlan, summaryOf, tabOf, type PlanLoad, type Spot, type Tab } from "./data.ts";
import { HallTab, KitchenTab, PetsTab, RoomTab, TAB_NAME } from "./panels.tsx";
import { GymTab } from "./GymTab.tsx";
import { HavenLists } from "./HavenLists.tsx";
import { LightsPanel, type Look } from "./LightsPanel.tsx";
import { afterScene, held as heldLights, HOLD_MS, holdScene, LIGHTS_POLL_MS, loadLights, placeLightAt, placeLights, postLights, shownLights, type Holds, type LightsLoad } from "./lights.ts";
import { lightKey, type PlanLight } from "../../../api/_haven/planShape.ts";
import { isRun, kindOf } from "./fixtures.ts";
import { ClimatePop } from "./ClimatePop.tsx";
import { PetlibroPop, VacuumPop, WhiskerPop } from "./DevicePops.tsx";
import { Plinth } from "./Plinth.tsx";
import { gaugesOf, type GaugeId } from "./plinth.ts";
import { moodOf, useClimateQueue } from "./climateQueue.ts";
import type { House, ThreadState } from "./house.ts";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { useIsPhone } from "@ceo/engine/web/phone.ts";
import { sectionOf } from "@ceo/engine/web/sections.ts";
import { navigateTo, routeOf, usePathname } from "../../../apps/world/src/route.ts";
import { SECTIONS } from "../sections.ts";
import { SheetSigils } from "./SheetSigils.tsx";
import "./haven.css";
import "./sheetdeck.css";

/**
 * The Haven (#616): home and health on the Desk. Nikita's round-6 pick: the house in 3D, night-lit behind frosted
 * glass, where only the rooms with something going on light up, with the house-wide readings on the instrument plinth
 * in the dark to its lower right (#680), a thread of nanites from each gauge's lamp to its device. Tap a room and the camera flies in (300 ms), the house blurs behind,
 * and the room's content opens over it (Kitchen, Hall, Pets, Gym, or the room's own sheet). Each tab has its own address
 * (/haven/kitchen and on, `../sections.ts`, #871), which the Desk's bar lists under the Haven.
 *
 * Privacy: the floor plan lives in the private store and is read only by a passkey session (/api/haven-plan); signed
 * out the Haven shows counts and states only, with no map. Health, pantry and device details stay behind the passkey.
 * The 3D chunk (three, from the Lattice's own chunk) loads only when there is a plan to draw.
 */

const ACCENT = "240,201,135";
/** The tabs, from the sub-menu past the house (`../sections.ts`), so the bar and the page list the same ones. */
const TABS = SECTIONS.slice(1).map((s) => s.id as Tab);

const reduce = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const dayWord = (d = new Date()) => `${d.toLocaleDateString("en-US", { weekday: "long" })} ${d.getHours() < 12 ? "morning" : d.getHours() < 17 ? "afternoon" : "evening"}`;
const stateWord: Record<VendorState, string> = { live: "live", down: "down", waiting: "waiting" };

type Open = { tab: Tab } | { room: string } | null;

const thePlanOf = (p: PlanLoad) => (p.state === "ready" ? p.plan : null);

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
  // The open tab is the address's (#871): /haven/kitchen opens the Kitchen, on a reload and back and forward too. A
  // room picked on the house has no address of its own and opens over /haven.
  const pathname = usePathname();
  const section = routeOf(pathname) === "haven" ? sectionOf(SECTIONS, pathname).id : "house";
  const pathTab = section === "house" ? null : (section as Tab);
  const [room, setRoom] = useState<string | null>(null);
  const open: Open = useMemo(() => (pathTab ? { tab: pathTab } : room ? { room } : null), [pathTab, room]);
  const setOpen = useCallback((o: Open) => {
    setRoom(o && "room" in o ? o.room : null);
    if (routeOf(window.location.pathname) === "haven") navigateTo((o && "tab" in o ? `/haven/${o.tab}` : "/haven") + window.location.search);
  }, []);
  const [gl, setGl] = useState<"idle" | "on" | "none">("idle");
  // On a phone (#1045) the controls come first and the house lies behind them, dimmed and still to the touch; "Explore
  // the house" brings it forward to turn, zoom and tap, with the controls set aside until "Back to the controls".
  const phone = useIsPhone();
  const [explore, setExplore] = useState(false);
  const behind = useRef(false);
  behind.current = phone && !explore;
  useEffect(() => {
    if (!phone) setExplore(false);
  }, [phone]);
  // Sent from the Kitchen chip or Controls (?open=kitchen): the Kitchen opens (#664).
  const houseHost = useRef<HTMLDivElement>(null);
  const labelHost = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const house = useRef<House | null>(null);
  const lamps = useRef<Partial<Record<GaugeId, HTMLElement | null>>>({});
  const strip = useRef<HTMLElement>(null);

  useEffect(() => startHome(), []);
  // The old ?open=kitchen spelling becomes the Kitchen's own address, in place.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("open") !== "kitchen" || routeOf(window.location.pathname) !== "haven") return;
    q.delete("open");
    navigateTo(`/haven/kitchen${q.size ? `?${q}` : ""}`, true);
  }, []);
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

  // The lights (#931): SwitchBot and Govee, passkey only, read every 25 s while the Haven is on screen (#1020), and at
  // once, fresh, when the tab comes back.
  const [lights, setLights] = useState<LightsLoad>({ state: "idle" });
  const [lightBusy, setLightBusy] = useState<string | null>(null);
  const [lightNote, setLightNote] = useState<string | null>(null);
  // What a switch or a scene was set to, held against reads that still say otherwise (#1022, lights.ts held).
  const holds = useRef<Holds>(new Map());
  const shown = useCallback((l: LightsLoad): LightsLoad => (l.state === "ready" ? { state: "ready", view: heldLights(l.view, holds.current, Date.now()) } : l), []);
  useEffect(() => {
    if (!signedIn) return setLights({ state: "idle" });
    let gone = false;
    const read = (fresh = false) => void loadLights(fetch, fresh).then((l) => !gone && (l.state === "out" ? useDeskAuth.getState().lost() : setLights((cur) => (l.state === "failed" && cur.state === "ready" ? cur : shown(l)))));
    read();
    const t = window.setInterval(() => document.visibilityState === "visible" && read(), LIGHTS_POLL_MS);
    const back = () => document.visibilityState === "visible" && read(true);
    document.addEventListener("visibilitychange", back);
    return () => {
      gone = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", back);
    };
  }, [signedIn, shown]);
  // The lights Nikita uses (#1002): the ones he doesn't (lights.ts HIDDEN_LIGHTS) are left out of the panel and the house.
  const lightView = useMemo(() => (lights.state === "ready" ? { ...lights.view, lights: shownLights(lights.view.lights) } : null), [lights]);
  // The vendors' states read again, fresh (#1020): what really happened wins over what was shown at once.
  const refresh = useCallback(() => loadLights(fetch, true).then((l) => l.state === "ready" && setLights(shown(l))), [shown]);
  const setLight = useCallback(async (id: string, on: boolean) => {
    setLightBusy(id);
    setLightNote(null);
    // The switch shows at once; it goes back if the vendor refuses.
    const flip = (v: boolean | null) => (l: LightsLoad): LightsLoad => (l.state === "ready" ? { state: "ready", view: { ...l.view, lights: l.view.lights.map((x) => (x.id === id ? { ...x, on: v } : x)) } } : l);
    const was = lights.state === "ready" ? (lights.view.lights.find((x) => x.id === id)?.on ?? null) : null;
    setLights(flip(on));
    holds.current.set(id, { on, until: Date.now() + HOLD_MS });
    const r = await postLights({ op: "set", id, on });
    setLightBusy(null);
    if (!r.ok) {
      holds.current.delete(id);
      setLights(flip(was));
      setLightNote(r.say);
    } else window.setTimeout(() => void refresh(), 3_000);
  }, [lights, refresh]);
  const runScene = useCallback(async (id: string) => {
    setLightBusy(id);
    setLightNote(null);
    const r = await postLights({ op: "scene", id });
    setLightBusy(null);
    setLightNote(r.say);
    if (!r.ok) return;
    // An off scene shows every switch off at once (#1020) and holds them off (#1022) while the real switches follow:
    // reads that still say on don't turn them back on; one that agrees, or the hold's end, hands back to the reads.
    setLights((cur) => {
      if (cur.state !== "ready") return cur;
      const name = cur.view.scenes.find((x) => x.id === id)?.name ?? "";
      holdScene(cur.view, name, holds.current, Date.now());
      return { state: "ready", view: afterScene(cur.view, name) };
    });
    for (const ms of [2_500, 8_000, 20_000, HOLD_MS + 2_000]) window.setTimeout(() => void refresh(), ms);
  }, [refresh]);
  // A Govee light's colour, white, brightness or mood (#974): Skippy's line back when it didn't take.
  const setLook = useCallback(async (id: string, look: Look) => {
    setLightBusy(id);
    setLightNote(null);
    const r = await postLights({ op: "look", id, ...look });
    setLightBusy(null);
    if (!r.ok) setLightNote(r.say);
    else window.setTimeout(() => void refresh(), 1_500);
  }, [refresh]);
  // Where the lights stand (#974): the plan's spots, kept here so placing one doesn't rebuild the house.
  const [spots, setSpots] = useState<PlanLight[] | null>(null);
  useEffect(() => setSpots(null), [plan]);
  const theSpots = useMemo(() => spots ?? thePlanOf(plan)?.lights ?? [], [spots, plan]);
  const placedIds = useMemo(() => new Set(thePlanOf(plan) && lightView ? placeLights(thePlanOf(plan)!, lightView.lights, theSpots).placed.map((p) => p.light.id) : []), [plan, lightView, theSpots]);
  // Placing a light: tap it in the panel, then its spot on the house.
  const [placing, setPlacing] = useState<string | null>(null);

  const devices = signedIn ? (home?.devices ?? null) : null;
  // The Nest (#637): live from the thermostat's reading once it's connected; waiting before, and always signed out.
  const climate = useMemo(() => climateOf(devices), [devices]);
  const kitchenOpen = signedIn ? (items ? items.filter((i) => !i.done).length : null) : (counts?.kitchen ?? null);
  const openList = useMemo(() => (signedIn ? openTodos(todos, Date.now()) : []), [todos, signedIn]);
  const todoCount = signedIn ? openList.length : (counts?.todos ?? null);
  const thePlan = plan.state === "ready" ? plan.plan : null;
  useRoomReady(homeLoad !== "idle" && (thePlan ? gl !== "idle" : auth !== "checking" && (!signedIn || plan.state !== "idle")));
  const hasGym = !!counts?.gym;
  const lit = useMemo(() => (thePlan ? litRooms(thePlan, { devices, kitchenOpen, climate, gym: hasGym, now: Date.now() }) : {}), [thePlan, devices, kitchenOpen, climate, hasGym]);
  // The thermostat control (#671): from the plinth's Climate dial or the Nest's marker, passkey only.
  const thermo = signedIn ? (devices?.find((d) => d.kind === "thermostat") ?? null) : null;
  // The strip's open pop-up (#718): Climate's control, or a device's controls.
  const [pop, setPop] = useState<GaugeId | null>(null);
  const closePop = useCallback(() => setPop(null), []);
  // The gauges in the order their threads land on screen (house.ts), so none cross.
  const [order, setOrder] = useState<GaugeId[] | null>(null);
  const held = useClimateQueue((s) => s.pending);
  const vendors: Record<Vendor, VendorState> = useMemo(() => (signedIn ? home?.vendors : pub?.vendors) ?? { roborock: "waiting", petlibro: "waiting", whisker: "waiting", nest: "waiting" }, [signedIn, home, pub]);

  /* ── the 3D house, only with a plan ── */
  const onPick = useCallback((id: string | null) => {
    if (id) setOpen({ room: id });
  }, [setOpen]);
  useEffect(() => {
    if (!thePlan || !houseHost.current || !labelHost.current) return;
    let gone = false;
    void import("./house.ts").then(({ House, canDraw3D }) => {
      if (gone || !houseHost.current || !labelHost.current) return;
      if (!canDraw3D()) return setGl("none");
      try {
        const head = houseHost.current.parentElement?.querySelector(".hv-head");
        // Behind the controls on a phone the house fits its whole box: nothing to keep clear of.
        const clearTop = () => (!behind.current && head && houseHost.current ? head.getBoundingClientRect().bottom - houseHost.current.getBoundingClientRect().top : 0);
        const host = houseHost.current;
        // The strip's box and each lamp, in the house's own frame (#680): the fit keeps the rooms clear of the strip,
        // and each thread starts at its lamp (none for a gauge scrolled out of sight on a phone).
        const keepClear = () => {
          const s = strip.current?.getBoundingClientRect(), h = host.getBoundingClientRect();
          if (behind.current) return null;
          return s && s.width ? { x: s.left - h.left, y: s.top - h.top, w: s.width, h: s.height } : null;
        };
        const lampAt = (id: GaugeId): [number, number] | null => {
          const el = lamps.current[id], s = strip.current?.getBoundingClientRect();
          if (!el || !s || behind.current) return null;
          const b = el.getBoundingClientRect(), h = host.getBoundingClientRect();
          const x = b.left + b.width / 2, y = b.top + b.height / 2;
          // Out of sight when the strip (or the rail, #729) has scrolled it away.
          if (!b.width || x < s.left + 4 || x > s.right - 4 || y < s.top + 2 || y > s.bottom - 2) return null;
          return [x - h.left, y - h.top];
        };
        const rail = () => strip.current?.dataset.rail === "side";
        house.current = new House(host, labelHost.current, thePlan, { reduce: reduce(), onPick, onAway: setAway, clearTop, keepClear, lampAt, rail, onOrder: setOrder, onSpot: (spot) => spot === "thermostat" && setPop("climate") });
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

  // The lights on the house (#931, #974, #1020): each placed light drawn and lit as it really is, with no marker over
  // it (the Lights panel switches and moves them). Until the lights are read (or without their keys), the rooms'
  // activity glow stands in.
  useEffect(() => {
    house.current?.setLights(lightView?.lights ?? null, theSpots);
  }, [gl, lightView, theSpots]);
  // A row of spots or a backlight (#1007, fixtures.ts) is a run: two taps, where it starts and where it ends.
  const [runStart, setRunStart] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => setRunStart(null), [placing]);
  const placingName = placing ? (lightView?.lights.find((l) => l.id === placing)?.name ?? null) : null;
  const placingRun = placingName !== null && isRun(kindOf(placingName, theSpots.find((s) => lightKey(s.name) === lightKey(placingName))));
  useEffect(() => {
    const name = placingName;
    house.current?.setPlacing(name, (x, y) => {
      if (!name) return;
      if (placingRun && !runStart) return setRunStart({ x, y });
      setPlacing(null);
      const at = placingRun && runStart ? { ...runStart, x2: x, y2: y } : { x, y };
      void placeLightAt(name, at).then((r) => (r.ok ? (setSpots(r.spots), setLightNote(`${name} is on the map.`)) : setLightNote(r.say)));
    });
  }, [placingName, placingRun, runStart, gl]);
  useEffect(() => {
    if (!placing) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setPlacing(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [placing]);

  // Myshka in the house (#729): a feed (the dry feeder's last meal, or the wet tray opened from here) and the
  // Litter-Robot's cycle, nothing else; the house decides where he walks.
  useEffect(() => {
    const dry = devices?.find((d) => d.kind === "dry-feeder"), wet = devices?.find((d) => d.kind === "wet-feeder"), box = devices?.find((d) => d.kind === "litter");
    const times = [dry?.lastFed, wet?.closesAt].map((v) => (v ? Date.parse(v) : NaN)).filter(Number.isFinite);
    house.current?.setCat({ fedAt: times.length ? Math.max(...times) : null, litterCycling: Boolean(box?.online && /cycl/i.test(box.state)) });
  }, [devices, gl]);

  // Opening a room flies the camera in and lays the house behind the content; closing flies back out.
  const roomId = open && "room" in open ? open.room : open && "tab" in open && thePlan ? (thePlan.rooms.find((r) => tabOf(thePlan, r) === open.tab)?.id ?? null) : null;
  useEffect(() => {
    house.current?.focus(roomId);
    house.current?.setBackdrop(open !== null);
  }, [roomId, open, gl]);
  // The sheet opens below the Desk's nav, whatever height the nav wraps to.
  const [top, setTop] = useState(60);
  // The section switcher sticks under the Desk's nav, whatever height the nav wraps to.
  const [navH, setNavH] = useState(60);
  useEffect(() => {
    const m = () => setNavH(Math.round(document.querySelector(".wv-nav")?.getBoundingClientRect().height ?? 60));
    m();
    window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, []);
  useEffect(() => {
    if (!open) return;
    // The house behind the sheet is at the top of the page: bring it into view, then measure the nav there.
    window.scrollTo({ top: 0 });
    setTop(Math.max(0, Math.round(document.querySelector(".wv-nav")?.getBoundingClientRect().bottom ?? 0)));
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, setOpen]);

  // On a phone the house fits again when it comes forward or goes back behind the controls; Escape sends it back.
  useEffect(() => {
    if (!phone) return;
    house.current?.refit();
    house.current?.touch();
    if (!explore) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setExplore(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [explore, phone, gl]);

  /* ── the instrument plinth (#680): the gauges, and their threads into the house ── */
  const gauges = useMemo(
    () => gaugesOf({ signedIn, loading: homeLoad === "idle", vendors, devices: pub?.devices ?? [], climate, kitchenOpen, gym: counts?.gym ?? null, todos: todoCount }),
    [signedIn, homeLoad, vendors, pub, climate, kitchenOpen, counts, todoCount],
  );
  useEffect(() => {
    const busy = (id: GaugeId, n: number | null) => (n === null ? 0 : Math.min(1, 0.15 + n / 8));
    const mood = moodOf(thermo, held && thermo && held.device === thermo.id ? held.f : null);
    const level: Record<GaugeId, number> = {
      climate: mood === "heat" || mood === "cool" ? 0.85 : 0.3,
      roborock: devices?.some((d) => d.kind === "vacuum" && /clean/i.test(d.state)) ? 0.9 : 0.4,
      petlibro: 0.4,
      whisker: 0.4,
      kitchen: busy("kitchen", kitchenOpen),
      gym: counts?.gym ? Math.min(1, 0.2 + counts.gym.doneThisWeek / Math.max(1, counts.gym.perWeek)) : 0,
      todos: busy("todos", todoCount),
    };
    // The climate's thread runs ember-orange while it heats and ice-blue while it cools (#718).
    const climateRgb = mood === "heat" ? "255,140,64" : mood === "cool" ? "110,180,255" : undefined;
    const list: ThreadState[] = gauges.map((g) => ({ id: g.id, tone: g.tone, level: level[g.id], ...(g.id === "climate" && climateRgb && { rgb: climateRgb }) }));
    house.current?.setThreads(list);
  }, [gauges, climate, devices, kitchenOpen, counts, todoCount, gl, thermo, held]);
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
  const togglePop = useCallback((id: GaugeId) => setPop((v) => (v === id ? null : id)), []);
  const canPop = useCallback((id: GaugeId) => (id === "climate" ? !!thermo : signedIn && (id === "roborock" || id === "petlibro" || id === "whisker")), [thermo, signedIn]);
  // The pop-up sits above its gauge: when the order changes, the threads move with it.
  useEffect(() => house.current?.touch(), [order]);
  const openGauge = useCallback((id: GaugeId) => (id === "kitchen" || id === "gym") && setOpen({ tab: id }), [setOpen]);
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
    <div className="hv fl-page" data-room="haven" data-open={open ? "" : undefined} data-explore={explore || undefined} style={{ ["--fl-accent" as string]: ACCENT, ["--hv-navh" as string]: `${navH}px` }}>
      <section className="hv-stage fl-stage" aria-label="The house">
        <div className="hv-houseWrap">
          <div className="hv-house ph-scene" ref={houseHost} data-gl={gl} data-ph-live={explore || undefined} />
          <div className="hv-labs" ref={labelHost} aria-hidden="true" />
          <header className="hv-head">
            <p className="fl-eyb">
              <span>Haven</span>
              <i />
              {dayWord()}
            </p>
            <h1 className="hv-h1">The Haven</h1>
            <p className="hv-sum">{summary}</p>
            {phone && gl === "on" && !explore && (
              <button type="button" className="hv-explore" onClick={() => setExplore(true)}>
                Explore the house
              </button>
            )}
            {/* The room tabs and the lists sit in the house's own corner, under its name (Nikita 2026-11-05: one piece
                with the house, not a bar above it). */}
            {signedIn && (
              <nav className="hv-tabs" aria-label="Haven rooms">
                {TABS.map((t) => (
                  <button key={t} type="button" className="hv-tab" aria-pressed={openTab === t} onClick={() => setOpen({ tab: t })}>
                    {TAB_NAME[t]}
                  </button>
                ))}
              </nav>
            )}
            <HavenLists />
            {signedIn && lightView && (
              <LightsPanel view={lightView} placed={placedIds} placing={placing} placingStep={placingRun ? (runStart ? "end" : "start") : null} canPlace={gl === "on"} busy={lightBusy} note={lightNote} onSet={(id, on) => void setLight(id, on)} onScene={(id) => void runScene(id)} onLook={(id, look) => void setLook(id, look)} onPlace={setPlacing} />
            )}
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
              {explore && (
                <button type="button" className="hv-reset hv-back2" onClick={() => setExplore(false)}>
                  Back to the controls
                </button>
              )}
              {away && (
                <button type="button" className="hv-reset" onClick={() => house.current?.resetView()}>
                  Reset view
                </button>
              )}
            </div>
          )}
          <Plinth gauges={gauges} order={order} thermo={thermo} pop={pop} onPop={togglePop} canPop={canPop} onOpen={openGauge} canOpen={canOpen} lamp={lamp} onScroll={touch} stripRef={strip}>
            {open || !signedIn ? null : pop === "climate" && thermo ? (
              <ClimatePop d={thermo} onClose={closePop} />
            ) : pop === "roborock" ? (
              <VacuumPop devices={devices} plan={thePlan} state={vendors.roborock} onClose={closePop} />
            ) : pop === "petlibro" ? (
              <PetlibroPop devices={devices} state={vendors.petlibro} onClose={closePop} />
            ) : pop === "whisker" ? (
              <WhiskerPop devices={devices} state={vendors.whisker} onClose={closePop} />
            ) : null}
          </Plinth>
        </div>
      </section>



      {open && signedIn && (
        <div className="hv-sheet" role="dialog" aria-modal="false" aria-label={sheetTitle} style={{ ["--hv-top" as string]: `${top}px` }}>
          <SheetSigils />
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
              <HallTab devices={devices} connected={vendors.roborock !== "waiting"} room={openRoom} plan={thePlan} />
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
