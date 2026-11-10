import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Keeper, type Wait } from "@ceo/desk/rooms/parts.tsx";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { LAYER_MM, PAWN, preflight, slice, STAGES, viewKey, type FlowView, type Stage } from "./flow.ts";
import type { Flow } from "./flowScene.ts";
import { PlateSigils } from "./PlateSigils.tsx";
import "@ceo/desk/rooms/rooms.css";
import "./workshop.css";

/**
 * The Workshop (#225, #827, #989): Nikita's own way from an idea to a thing on the shelf, as one line with one printer.
 * The line fills the screen (flowScene.ts): a long bench in 3D with the four stages along it, left to right, the design
 * on an easel, the mesh in a cage, the slicer's plate and the printer, solid in the middle and coming undone into gold
 * wire and sigil nanites at the frame's edges, the gold vault behind. Each station carries a tag with its real state
 * (flow.ts); pick one and the camera steps up to it, with its card beside it. Nothing is connected yet, so the easel is
 * blank, the cage is empty, the slicer holds the Workshop's own check piece and the printer waits; nothing ever prints
 * without a tap. Under the line, one console on a build plate: the four stages and what they wait on.
 */

const WAITS: Wait[] = [
  { what: "OpenAI images", why: "Stage 1: the design, made as an image the way it's made in ChatGPT. Kept on the server." },
  { what: "A Meshy API key", why: "Stage 2: turns the image into a meshed 3D model. Kept on the server." },
  { what: "The hub on the MacBook", why: "Stage 3: slices with Bambu Studio or OrcaSlicer, and talks to the printer on your network." },
  { what: "The printer's serial and LAN access code", why: "Stage 4: so the hub can send a sliced file and read back progress and the camera. Kept on the Mac, never here." },
];

const FLOW: FlowView = { k: "flow" };
const reduced = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Where the tags stand over the flat bench (percent of the hall), before the 3D is up or without WebGL. */
const FLAT_X = [17, 39, 61, 83];
const FLAT_Y = 56;
const STATE: Record<Stage["state"], string> = { idle: "idle", check: "check piece", waiting: "waiting" };
const TABS = [
  { id: "line", k: "The flow", b: "Four stages" },
  { id: "waits", k: "Waits on", b: `${WAITS.length} keys and links` },
] as const;
type Tab = (typeof TABS)[number]["id"];
const two = (n: number) => String(n).padStart(2, "0");

export function Workshop() {
  const hall = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const flow = useRef<Flow | null>(null);
  const plates = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = useRef(new Map<string, [number, number, boolean]>());
  const settle = useRef(0);
  const [view, setView] = useState<FlowView>(FLOW);
  const [gl, setGl] = useState<"wait" | "on" | "none">("wait");
  const [tab, setTab] = useState<Tab>("line");
  const ready = useRoomReady(false);
  const checks = useMemo(() => preflight(PAWN), []);
  const cut = useMemo(() => slice(PAWN), []);
  const passed = checks.filter((c) => c.ok).length;
  const allOk = passed === checks.length;

  // The tags ride their stations but never cover one another; one that would is lifted just above the one before.
  const spread = useCallback(() => {
    settle.current = 0;
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    const W = hall.current?.clientWidth ?? window.innerWidth;
    for (const s of STAGES) {
      const id = `stage-${s.n}`;
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
    void import("./flowScene.ts")
      .then(async ({ createFlow, canDraw3D }) => {
        if (gone || !host.current || !canvas.current) return;
        if (!canDraw3D()) throw new Error("no webgl");
        const f = await createFlow(host.current, canvas.current, {
          phone: window.innerWidth < 760,
          reduce: reduced(),
          onPick: (v) => setView(v),
          onPlace,
          headroom: () => {
            const box = hall.current?.getBoundingClientRect();
            const hd = head.current?.getBoundingClientRect();
            if (!box || !hd || !box.height) return 0;
            return Math.max(0, Math.min(0.6, (hd.bottom - box.top + 20) / box.height));
          },
          onReady: () => {
            setGl("on");
            ready();
          },
        });
        if (gone) return f.dispose();
        flow.current = f;
      })
      .catch(() => {
        if (gone) return;
        setGl("none");
        ready();
      });
    return () => {
      gone = true;
      cancelAnimationFrame(settle.current);
      flow.current?.dispose();
      flow.current = null;
    };
  }, [onPlace, ready]);

  useEffect(() => flow.current?.setView(view), [view, gl]);

  // Escape steps back out to the whole flow.
  useEffect(() => {
    if (view.k === "flow") return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setView(FLOW);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const stage = view.k === "stage" ? STAGES.find((s) => s.n === view.n) : undefined;
  const flat = (n: number) => ({ "--fx": `${FLAT_X[n - 1]}%`, "--fy": `${FLAT_Y}%` }) as CSSProperties;
  const plateRef = (id: string) => (el: HTMLButtonElement | null) => {
    plates.current[id] = el;
    if (el && at.current.size && !settle.current) settle.current = requestAnimationFrame(spread);
  };
  const onFlow = view.k === "flow";
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
      <section ref={hall} className="ws-hall" aria-label="The Workshop's flow" data-view={viewKey(view)} data-gl={gl}>
        <div className="ws-flat" aria-hidden="true">
          <i className="ws-flat-bench" />
          <i className="ws-flat-line" />
          {STAGES.map((s) => (
            <i key={s.n} className="ws-flat-st" data-id={s.id} style={{ left: `${FLAT_X[s.n - 1]}%` }} />
          ))}
        </div>
        <div className="ws-stage" ref={host}>
          <canvas ref={canvas} className="ws-cv" aria-hidden="true" />
        </div>
        <div className="ws-vig" aria-hidden="true" />

        <header ref={head} className="ws-head">
          <p className="ws-eyb">
            The Workshop <i /> one printer, four stages
          </p>
          <h1 className="ws-h1 desk__title">
            From a picture <em>to a print.</em>
          </h1>
          <p className="ws-sub">An image designed in ChatGPT, meshed into a 3D model, made ready in the slicer, printed on the one printer. Nothing is connected yet, so nothing is moving through it.</p>
          <dl className="ws-stats">
            <div>
              <dt>Stages</dt>
              <dd>{STAGES.length}</dd>
            </div>
            <div>
              <dt>In the flow</dt>
              <dd>0</dd>
            </div>
            <div>
              <dt>Printing</dt>
              <dd>0</dd>
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

        {gl === "none" && <p className="ws-nogl">This browser can't draw the bench in 3D, so it's drawn flat; every stage and the check are here all the same.</p>}

        <ol className="ws-plates" aria-label="Along the bench">
          {STAGES.map((s) => {
            const id = `stage-${s.n}`;
            return (
              <li key={s.n}>
                <button
                  type="button"
                  ref={plateRef(id)}
                  className="ws-plate"
                  data-state={s.state}
                  style={flat(s.n)}
                  tabIndex={onFlow ? 0 : -1}
                  aria-label={`Stage ${s.n}, ${s.name}: ${s.now}. ${s.wait}. Step up to it.`}
                  onClick={() => setView({ k: "stage", n: s.n })}
                >
                  <span className="ws-plate-k">
                    <i aria-hidden="true" />
                    {two(s.n)} {s.name}
                    <span>{STATE[s.state]}</span>
                  </span>
                  <strong>{s.now}</strong>
                  {s.id === "slice" ? (
                    <span className="ws-plate-checks" aria-hidden="true">
                      {checks.map((c) => (
                        <i key={c.id} data-ok={c.ok ? "1" : "0"} title={c.label} />
                      ))}
                      <span>
                        {passed}/{checks.length} · {cut.layers} layers
                      </span>
                    </span>
                  ) : s.id === "print" ? (
                    <>
                      <span className="ws-plate-job">
                        <span>Job</span> none <span>Layer</span> none
                      </span>
                      <span className="ws-plate-bar" aria-hidden="true">
                        <i style={{ width: "0%" }} />
                      </span>
                    </>
                  ) : null}
                  <small>{s.wait}</small>
                </button>
              </li>
            );
          })}
        </ol>

        <nav className="ws-views" aria-label="Where to look">
          <button type="button" aria-pressed={view.k === "flow"} onClick={() => setView(FLOW)}>
            The flow
          </button>
          {STAGES.map((s) => (
            <button key={s.n} type="button" aria-pressed={view.k === "stage" && view.n === s.n} onClick={() => setView({ k: "stage", n: s.n })}>
              <b>{s.n}</b> {s.name}
            </button>
          ))}
          <span className="ws-keys" aria-hidden="true">
            A D swivel · W S in and out · Esc back
          </span>
        </nav>

        {stage && (
          <aside className="ws-card" aria-live="polite" aria-label={`Stage ${stage.n}, ${stage.name}`}>
            <p className="ws-card-k">
              Stage {two(stage.n)} of {two(STAGES.length)} · {STATE[stage.state]}
            </p>
            <h2 className="ws-card-h">{stage.name}</h2>
            <p className="ws-card-tool">{stage.tool}</p>
            <p className="ws-note">{stage.inside}</p>
            {stage.id === "slice" ? (
              <>
                <ul className="ws-checks">
                  {checks.map((c) => (
                    <li key={c.id} data-ok={c.ok ? "1" : "0"}>
                      <span aria-hidden="true">{c.ok ? "✓" : "✕"}</span>
                      <b>{c.label}</b>
                      <em>{c.detail}</em>
                    </li>
                  ))}
                  <li data-ok="1">
                    <span aria-hidden="true">≡</span>
                    <b>Sliced</b>
                    <em>
                      {cut.layers} layers at {LAYER_MM.toFixed(2)} mm
                    </em>
                  </li>
                </ul>
                <p className="ws-note ws-quiet">{stage.wait}. Nothing prints without your tap.</p>
              </>
            ) : (
              <dl className="ws-chamber">
                <div>
                  <dt>Now</dt>
                  <dd>{stage.now}</dd>
                </div>
                {stage.id === "print" ? (
                  <>
                    <div>
                      <dt>Job</dt>
                      <dd>None</dd>
                    </div>
                    <div>
                      <dt>Camera</dt>
                      <dd>Waits on the LAN</dd>
                    </div>
                  </>
                ) : (
                  <div className="ws-chamber-w">
                    <dt>Waits on</dt>
                    <dd>{stage.wait.replace(/^Waits on /, "")}</dd>
                  </div>
                )}
              </dl>
            )}
            <div className="ws-card-nav">
              <button type="button" className="ws-back" onClick={() => setView(FLOW)}>
                Back to the flow
              </button>
              {stage.n < STAGES.length && (
                <button type="button" className="ws-back ws-next" onClick={() => setView({ k: "stage", n: (stage.n + 1) as Stage["n"] })}>
                  Next: {STAGES[stage.n]!.name} →
                </button>
              )}
            </div>
          </aside>
        )}
      </section>

      {/* Under the line, one console on a build plate (#932): the four stages and what they wait on, one at a time. */}
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
              {STAGES.map((s) => (
                <li key={s.n} data-ok={s.state === "check" ? "1" : "0"}>
                  <span className="ws-gc" aria-hidden="true">
                    N{two(s.n)}
                  </span>
                  <b className="ws-line-t">{s.name}</b>
                  <span className="ws-line-s">{s.tool}</span>
                  <span className="ws-line-now">{s.id === "slice" ? `${s.now}: ${passed}/${checks.length} checks, ${cut.layers} layers` : s.now}</span>
                  <em>{s.wait}</em>
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
