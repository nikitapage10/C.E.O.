import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keeper, Waits, type Wait } from "@ceo/desk/rooms/parts.tsx";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { BAYS, PAWN, preflight, viewKey, type FarmView } from "./farm.ts";
import type { Farm } from "./farmScene.ts";
import "@ceo/desk/rooms/rooms.css";
import "./workshop.css";

/**
 * The Workshop (#225, #827): from a sentence to a thing on the shelf, as a print farm. Printers stand on a long bench
 * in 3D (farmScene.ts), solid in the middle of the frame and coming undone into gold wire and sigil nanites at its
 * edges, the Senate's look. Pick a printer (or its tag, or its row beside it) and the camera steps inside its chamber;
 * pick the turntable and it comes round to the pre-print check (farm.ts), where the Workshop's own check piece is
 * measured against the plate. Nothing is connected yet, so the one printer waits, the open bays stay open, nothing is
 * printing, and nothing ever prints without a tap. The line and what it waits on stay below, as before.
 */

const STATIONS = [
  { k: "01", t: "Style", s: "A preset and your prompt", w: "Ready when the rest is" },
  { k: "02", t: "Picture", s: "Front and side, from OpenAI", w: "Waits on the image model" },
  { k: "03", t: "Model", s: "Meshy turns it into 3D", w: "Waits on a Meshy key" },
  { k: "04", t: "Check", s: "On the turntable, against the plate", w: "Checks the test piece for now" },
  { k: "05", t: "Slice", s: "Bambu Studio or OrcaSlicer, on the Mac", w: "Waits on the hub" },
  { k: "06", t: "Print", s: "The Bambu Lab printer, over the LAN", w: "Waits on the printer" },
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

export function Workshop() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const farm = useRef<Farm | null>(null);
  const tags = useRef<Record<string, HTMLButtonElement | null>>({});
  const [view, setView] = useState<FarmView>(FARM);
  const [gl, setGl] = useState<"wait" | "on" | "none">("wait");
  const ready = useRoomReady(false);
  const checks = useMemo(() => preflight(PAWN), []);

  const onPlace = useCallback((id: string, x: number, y: number, on: boolean) => {
    const el = tags.current[id];
    if (!el) return;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    el.dataset.on = on ? "1" : "0";
  }, []);

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
      farm.current?.dispose();
      farm.current = null;
    };
  }, [onPlace, ready]);

  useEffect(() => farm.current?.setView(view), [view, gl]);

  // Picked from the panel under the stage (a phone): bring the stage back into sight to watch the camera go.
  const go = useCallback((v: FarmView) => {
    setView(v);
    const el = host.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom < 120 || r.top > window.innerHeight * 0.6) el.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
  }, []);

  // Escape steps back out to the farm.
  useEffect(() => {
    if (view.k === "farm") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setView(FARM);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const bay = view.k === "bay" ? BAYS.find((b) => b.n === view.n) : undefined;
  const allOk = checks.every((c) => c.ok);

  return (
    <div className="wv-page rm rm-workshop" data-room="workshop">
      <header className="rm-head">
        <div>
          <p className="wv-eyb">The Workshop · the print farm</p>
          <h1 className="wv-h1 desk__title">
            From a sentence <em>to a thing on the shelf.</em>
          </h1>
          <p className="wv-sub">
            Describe something; the Workshop draws it, Meshy makes it a model, the turntable checks it against the plate, the Mac slices it, and the Bambu Lab printer prints
            it when you tap. Nothing is connected yet, so nothing is printing.
          </p>
        </div>
        <Keeper page="workshop" />
      </header>

      <section className="ws-farm" aria-label="The print farm" data-view={viewKey(view)} data-gl={gl}>
        <div className="ws-stage" ref={host}>
          <canvas ref={canvas} className="ws-cv" aria-hidden="true" />
          {gl === "none" && <p className="ws-nogl">This browser can't draw the farm in 3D. The bays and the check are listed here all the same.</p>}
          <div className="ws-tags">
            {BAYS.map((b) => (
              <button
                key={b.n}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="ws-tag"
                data-state={b.state}
                ref={(el) => void (tags.current[`bay-${b.n}`] = el)}
                onClick={() => setView({ k: "bay", n: b.n })}
              >
                <b>Bay {b.n}</b> <span>{b.state === "waiting" ? "waiting" : "open"}</span>
              </button>
            ))}
            <button type="button" tabIndex={-1} aria-hidden="true" className="ws-tag" data-state="table" ref={(el) => void (tags.current.table = el)} onClick={() => setView(TABLE)}>
              <b>Turntable</b> <span>{allOk ? "checked" : "check"}</span>
            </button>
          </div>
          <nav className="ws-views" aria-label="Where to look">
            <button type="button" aria-pressed={view.k === "farm"} onClick={() => setView(FARM)}>
              The farm
            </button>
            <button type="button" aria-pressed={view.k === "table"} onClick={() => setView(TABLE)}>
              The turntable
            </button>
            {view.k === "bay" && (
              <button type="button" aria-pressed="true">
                Inside bay {view.n}
              </button>
            )}
          </nav>
        </div>

        <div className="ws-panel" aria-live="polite">
          {view.k === "farm" && (
            <>
              <p className="wv-eyb">The bench</p>
              <h2 className="wv-h3">One printer, three open bays.</h2>
              <p className="ws-note">Pick a printer to step inside its chamber, or the turntable to check a design before it prints.</p>
              <ol className="ws-bays">
                {BAYS.map((b) => (
                  <li key={b.n} data-state={b.state}>
                    <button type="button" onClick={() => go({ k: "bay", n: b.n })}>
                      <span className="ws-bayn">{b.n}</span>
                      <b>{b.name}</b>
                      <em>{b.line}</em>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
          {view.k === "table" && (
            <>
              <p className="wv-eyb">The turntable · pre-print check</p>
              <h2 className="wv-h3">The check piece, a 40 mm pawn.</h2>
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
              <button type="button" className="ws-back" onClick={() => go(FARM)}>
                Back to the farm
              </button>
            </>
          )}
          {bay && (
            <>
              <p className="wv-eyb">
                Inside bay {bay.n} · {bay.state === "waiting" ? "waiting" : "open"}
              </p>
              <h2 className="wv-h3">{bay.name}</h2>
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
              <div className="ws-hop">
                <button type="button" className="ws-back" onClick={() => go(FARM)}>
                  Back to the farm
                </button>
                {BAYS.filter((b) => b.n !== bay.n).map((b) => (
                  <button key={b.n} type="button" className="ws-back" onClick={() => go({ k: "bay", n: b.n })}>
                    Bay {b.n}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="ws-line" aria-label="The line">
        <h2 className="rm-h2">The line</h2>
        <ol>
          {STATIONS.map((s) => (
            <li key={s.k}>
              <span className="ws-node" aria-hidden="true">
                {s.k}
              </span>
              <b>{s.t}</b>
              <span>{s.s}</span>
              <em>{s.w}</em>
            </li>
          ))}
        </ol>
      </section>

      <Waits items={WAITS} className="ws-waits" />
    </div>
  );
}
