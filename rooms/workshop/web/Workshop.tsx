import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Keeper, type Wait } from "@ceo/desk/rooms/parts.tsx";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { BAYS, PAWN, preflight, viewKey, type FarmView } from "./farm.ts";
import type { Farm } from "./farmScene.ts";
import { PlateSigils } from "./PlateSigils.tsx";
import "@ceo/desk/rooms/rooms.css";
import "./workshop.css";

/**
 * The Workshop (#225, #827, #932): from a sentence to a thing on the shelf, as a print farm. The farm fills the screen
 * (farmScene.ts): printers on a long bench in 3D, solid in the middle and coming undone into gold wire and sigil nanites
 * at the frame's edges, a gold vault running off into the depth behind them. What each printer is doing rides on it as
 * a job plate, and the turntable's plate carries the pre-print check (farm.ts). Pick a plate (or the printer) and the
 * camera steps inside its chamber, with its card beside it; pick the turntable and it comes round to the check. Nothing
 * is connected yet, so the one printer waits, the open bays stay open, nothing is printing, and nothing ever prints
 * without a tap. Under the farm, one console on a build plate: the line from a sentence to a print, and what it waits on.
 */

const STATIONS = [
  { k: "01", t: "Style", s: "A preset and your prompt", w: "Ready when the rest is", ok: true },
  { k: "02", t: "Picture", s: "Front and side, from OpenAI", w: "Waits on the image model", ok: false },
  { k: "03", t: "Model", s: "Meshy turns it into 3D", w: "Waits on a Meshy key", ok: false },
  { k: "04", t: "Check", s: "On the turntable, against the plate", w: "Checks the test piece for now", ok: true },
  { k: "05", t: "Slice", s: "Bambu Studio or OrcaSlicer, on the Mac", w: "Waits on the hub", ok: false },
  { k: "06", t: "Print", s: "The Bambu Lab printer, over the LAN", w: "Waits on the printer", ok: false },
];

const WAITS: Wait[] = [
  { what: "A Meshy API key", why: "Turns the front and side pictures into a model. Kept on the server." },
  { what: "The printer's serial and LAN access code", why: "So the hub on the Mac can send a sliced file and read back progress and the camera. Kept on the Mac, never here." },
  { what: "The hub on the MacBook", why: "Slices with Bambu Studio or OrcaSlicer, and talks to the printer on your network." },
  { what: "OpenAI for the pictures", why: "One prompt, two views: front and side, in the chosen style." },
];

const FARM: FarmView = { k: "farm" };
const TABLE: FarmView = { k: "table" };
const reduced = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Where the plates stand over the flat bench (percent of the hall), before the 3D is up or without WebGL. */
const FLAT: Record<string, [number, number]> = { "bay-1": [22, 58], "bay-2": [41, 58], "bay-3": [60, 58], "bay-4": [79, 58], table: [50, 84] };
/** Laid out first to last: the printer that's real, the turntable, then the open bays. */
const ORDER = ["bay-1", "table", "bay-2", "bay-3", "bay-4"];
const TABS = [
  { id: "line", k: "The line", b: "Six stations" },
  { id: "waits", k: "Waits on", b: `${WAITS.length} keys and links` },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function Workshop() {
  const hall = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const farm = useRef<Farm | null>(null);
  const plates = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = useRef(new Map<string, [number, number, boolean]>());
  const settle = useRef(0);
  const [view, setView] = useState<FarmView>(FARM);
  const [gl, setGl] = useState<"wait" | "on" | "none">("wait");
  const [tab, setTab] = useState<Tab>("line");
  const ready = useRoomReady(false);
  const checks = useMemo(() => preflight(PAWN), []);
  const passed = checks.filter((c) => c.ok).length;
  const printers = BAYS.filter((b) => b.state !== "open").length;
  const open = BAYS.length - printers;

  // The plates ride their printers but never cover one another: the real printer first, then the turntable, then the
  // open bays; one that would cover a plate already placed is lifted just above it.
  const spread = useCallback(() => {
    settle.current = 0;
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    const W = hall.current?.clientWidth ?? window.innerWidth;
    for (const id of ORDER) {
      const el = plates.current[id];
      const p = at.current.get(id);
      if (!el) continue;
      if (!p || !p[2]) {
        el.dataset.on = "0";
        continue;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const x = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, p[0]));
      let y = p[1];
      for (let k = 0; k < 6; k++) {
        const box = { l: x - w / 2 - 4, r: x + w / 2 + 4, t: y - 14 - h - 4, b: y - 14 + 4 };
        const hit = boxes.find((o) => o.l < box.r && box.l < o.r && o.t < box.b && box.t < o.b);
        if (!hit) {
          boxes.push(box);
          break;
        }
        y = hit.t + 14 - 4;
      }
      el.dataset.on = "1";
      el.style.setProperty("--gx", `${Math.round(x)}px`);
      el.style.setProperty("--gy", `${Math.round(y)}px`);
      el.style.setProperty("--tether", `${Math.max(12, Math.round(p[1] - y + 12))}px`);
    }
  }, []);

  const onPlace = useCallback(
    (id: string, x: number, y: number, on: boolean) => {
      const was = at.current.get(id);
      if (was && Math.abs(was[0] - x) < 0.5 && Math.abs(was[1] - y) < 0.5 && was[2] === on) return;
      at.current.set(id, [x, y, on]);
      if (!settle.current) settle.current = requestAnimationFrame(spread);
    },
    [spread],
  );

  useEffect(() => {
    let gone = false;
    void import("./farmScene.ts")
      .then(async ({ createFarm, canDraw3D }) => {
        if (gone || !host.current || !canvas.current) return;
        if (!canDraw3D()) throw new Error("no webgl");
        const f = await createFarm(host.current, canvas.current, {
          phone: window.innerWidth < 760,
          reduce: reduced(),
          onPick: (v) => setView(v),
          onPlace,
          headroom: () => {
            const box = hall.current?.getBoundingClientRect();
            const hd = head.current?.getBoundingClientRect();
            if (!box || !hd || !box.height) return 0;
            const share = Math.max(0, Math.min(0.6, (hd.bottom - box.top + 20) / box.height));
            return share;
          },
          onReady: () => {
            setGl("on");
            ready();
          },
        });
        if (gone) return f.dispose();
        farm.current = f;
      })
      .catch(() => {
        if (gone) return;
        setGl("none");
        ready();
      });
    return () => {
      gone = true;
      cancelAnimationFrame(settle.current);
      farm.current?.dispose();
      farm.current = null;
    };
  }, [onPlace, ready]);

  useEffect(() => farm.current?.setView(view), [view, gl]);

  // Escape steps back out to the farm.
  useEffect(() => {
    if (view.k === "farm") return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setView(FARM);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const bay = view.k === "bay" ? BAYS.find((b) => b.n === view.n) : undefined;
  const allOk = passed === checks.length;
  const flat = (id: string) => ({ "--fx": `${FLAT[id]![0]}%`, "--fy": `${FLAT[id]![1]}%` }) as CSSProperties;
  const plateRef = (id: string) => (el: HTMLButtonElement | null) => {
    plates.current[id] = el;
    if (el && at.current.size && !settle.current) settle.current = requestAnimationFrame(spread);
  };
  const onFarm = view.k === "farm";
  // The console's tabs: the arrows move between them, Home and End jump to the ends.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = TABS.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(TABS[to]!.id);
    tabs.current[to]?.focus();
  };

  return (
    <div className="wv-page rm rm-workshop ws-page" data-room="workshop">
      <section ref={hall} className="ws-hall" aria-label="The print farm" data-view={viewKey(view)} data-gl={gl}>
        <div className="ws-flat" aria-hidden="true">
          <i className="ws-flat-bench" />
          {BAYS.map((b) => (
            <i key={b.n} className="ws-flat-bay" data-state={b.state} style={{ left: `${FLAT[`bay-${b.n}`]![0]}%` }} />
          ))}
          <i className="ws-flat-table" />
        </div>
        <div className="ws-stage" ref={host}>
          <canvas ref={canvas} className="ws-cv" aria-hidden="true" />
        </div>
        <div className="ws-vig" aria-hidden="true" />

        <header ref={head} className="ws-head">
          <p className="ws-eyb">
            The Workshop <i /> the print farm
          </p>
          <h1 className="ws-h1 desk__title">
            From a sentence <em>to a thing on the shelf.</em>
          </h1>
          <p className="ws-sub">A prompt becomes a picture, a model, a check on the turntable, a slice and a print, on your tap. Nothing is connected yet, so nothing is printing.</p>
          <dl className="ws-stats">
            <div>
              <dt>Printers</dt>
              <dd>{printers}</dd>
            </div>
            <div>
              <dt>Printing</dt>
              <dd>0</dd>
            </div>
            <div>
              <dt>Open bays</dt>
              <dd>{open}</dd>
            </div>
            <div data-ok={allOk ? "1" : "0"}>
              <dt>Check</dt>
              <dd>
                {passed}
                <small>/{checks.length}</small>
              </dd>
            </div>
          </dl>
        </header>

        {gl === "none" && <p className="ws-nogl">This browser can't draw the farm in 3D, so it's drawn flat; every bay and the check are here all the same.</p>}

        <ol className="ws-plates" aria-label="On the bench">
          {BAYS.map((b) => {
            const id = `bay-${b.n}`;
            return (
              <li key={b.n}>
                <button
                  type="button"
                  ref={plateRef(id)}
                  className={`ws-plate${b.state === "open" ? " is-open" : ""}`}
                  data-state={b.state}
                  style={flat(id)}
                  tabIndex={onFarm ? 0 : -1}
                  aria-label={`Bay ${b.n}: ${b.name}, ${b.line}. Step inside its chamber.`}
                  onClick={() => setView({ k: "bay", n: b.n })}
                >
                  <span className="ws-plate-k">
                    <i aria-hidden="true" />
                    Bay {b.n}
                    <span>{b.state === "waiting" ? "waiting" : "open"}</span>
                  </span>
                  {b.state === "open" ? (
                    <small>{b.line}</small>
                  ) : (
                    <>
                      <strong>{b.name}</strong>
                      <span className="ws-plate-job">
                        <span>Job</span> none <span>Layer</span> none
                      </span>
                      <span className="ws-plate-bar" aria-hidden="true">
                        <i style={{ width: "0%" }} />
                      </span>
                      <small>{b.line}</small>
                    </>
                  )}
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              ref={plateRef("table")}
              className="ws-plate is-table"
              data-state="table"
              style={flat("table")}
              tabIndex={onFarm ? 0 : -1}
              aria-label={`The turntable: the 40 mm check piece, ${passed} of ${checks.length} checks pass. Bring it round.`}
              onClick={() => setView(TABLE)}
            >
              <span className="ws-plate-k">
                <i aria-hidden="true" />
                Turntable
                <span>{allOk ? "checked" : "check"}</span>
              </span>
              <strong>The check piece, a 40 mm pawn</strong>
              <span className="ws-plate-checks" aria-hidden="true">
                {checks.map((c) => (
                  <i key={c.id} data-ok={c.ok ? "1" : "0"} title={c.label} />
                ))}
                <span>
                  {passed} of {checks.length} pass
                </span>
              </span>
            </button>
          </li>
        </ol>

        <nav className="ws-views" aria-label="Where to look">
          <button type="button" aria-pressed={view.k === "farm"} onClick={() => setView(FARM)}>
            The farm
          </button>
          <button type="button" aria-pressed={view.k === "table"} onClick={() => setView(TABLE)}>
            Turntable
          </button>
          {BAYS.map((b) => (
            <button key={b.n} type="button" className="ws-views-bay" aria-pressed={view.k === "bay" && view.n === b.n} aria-label={`Inside bay ${b.n}`} onClick={() => setView({ k: "bay", n: b.n })}>
              {b.n}
            </button>
          ))}
          <span className="ws-keys" aria-hidden="true">
            A D swivel · W S in and out · Esc back
          </span>
        </nav>

        {!onFarm && (
          <aside className="ws-card" aria-live="polite" aria-label={bay ? `Inside bay ${bay.n}` : "The turntable"}>
            {view.k === "table" && (
              <>
                <p className="ws-card-k">The turntable · pre-print check</p>
                <h2 className="ws-card-h">The check piece, a 40 mm pawn.</h2>
                <p className="ws-note">The Workshop's own test piece turns here until Meshy hands over a real design; each check is measured from its shape.</p>
                <ul className="ws-checks">
                  {checks.map((c) => (
                    <li key={c.id} data-ok={c.ok ? "1" : "0"}>
                      <span aria-hidden="true">{c.ok ? "✓" : "✕"}</span>
                      <b>{c.label}</b>
                      <em>{c.detail}</em>
                    </li>
                  ))}
                </ul>
                <p className="ws-note ws-quiet">Ready to slice once the hub is on the Mac. Nothing prints without your tap.</p>
              </>
            )}
            {bay && (
              <>
                <p className="ws-card-k">
                  Inside bay {bay.n} · {bay.state === "waiting" ? "waiting" : "open"}
                </p>
                <h2 className="ws-card-h">{bay.name}</h2>
                <p className="ws-note">{bay.inside}</p>
                {bay.state === "waiting" && (
                  <dl className="ws-chamber">
                    <div>
                      <dt>Job</dt>
                      <dd>None</dd>
                    </div>
                    <div>
                      <dt>Layer</dt>
                      <dd>None</dd>
                    </div>
                    <div>
                      <dt>Camera</dt>
                      <dd>Waits on the LAN</dd>
                    </div>
                  </dl>
                )}
              </>
            )}
            <button type="button" className="ws-back" onClick={() => setView(FARM)}>
              Back to the farm
            </button>
          </aside>
        )}
      </section>

      {/* Under the farm, one console on a build plate (#932): the line and what it waits on, one at a time. */}
      <section className="ws-deck" aria-label="The Workshop's console">
        <PlateSigils />
        <div className="ws-deck-top">
          <div className="ws-deck-tabs" role="tablist" aria-label="The console">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => void (tabs.current[i] = el)}
                type="button"
                role="tab"
                id={`ws-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="ws-panel"
                tabIndex={tab === t.id ? 0 : -1}
                className="ws-deck-tab"
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                <span>{t.k}</span> <b>{t.b}</b>
              </button>
            ))}
          </div>
          <Keeper page="workshop" className="ws-keeper" />
        </div>

        <div className="ws-deck-p" role="tabpanel" id="ws-panel" aria-labelledby={`ws-tab-${tab}`}>
          {tab === "line" ? (
            <ol className="ws-line">
              {STATIONS.map((s) => (
                <li key={s.k} data-ok={s.ok ? "1" : "0"}>
                  <span className="ws-gc" aria-hidden="true">
                    N{s.k}
                  </span>
                  <b className="ws-line-t">{s.t}</b>
                  <span className="ws-line-s">{s.s}</span>
                  <em>{s.w}</em>
                </li>
              ))}
            </ol>
          ) : (
            <ol className="ws-waits">
              {WAITS.map((w) => (
                <li key={w.what}>
                  <span className="ws-gc" aria-hidden="true">
                    M0
                  </span>
                  <b>{w.what}</b>
                  <span>{w.why}</span>
                  <em>Waiting</em>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
