import { useEffect, useMemo, useRef, useState } from "react";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { useSceneReady } from "@ceo/engine/web/roomReady.ts";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { boardView } from "../data/boardroom.ts";
import { invoicesLine, startInvoices, useInvoices } from "../data/invoices.ts";
import type { Board } from "./boardroomScene.ts";
import "./boardroom.css";

/**
 * The boardroom at the top of the Spire (#825): the whole screen under the bar is the Spire's top floor in 3D
 * (boardroomScene.ts, lazy loaded with three.js), a horseshoe table high in the tower with the Spire's own seated round
 * it in their real bodies. Over the scene: the board's word and the invoices' counts at the top left and foot, a tag
 * riding each seat, each pile of folders and the Executive's easel, and on the right the agenda: where the PayPal line
 * stands and the way down to the invoices. Counts only, the same the Lattice sees; the clients, amounts and the Send
 * button stay below, behind the passkey. Until the 3D is up, and without WebGL, the tags sit in a row over a gold grid,
 * so the room is whole and usable at once.
 */

type GL = "idle" | "loading" | "on" | "off";
const PHONE_Q = "(max-width: 760px)";
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_Q).matches;

export function Boardroom({ onInvoices }: { onInvoices: () => void }) {
  const load = useInvoices((s) => s.load);
  const status = useInvoices((s) => s.status);
  const auth = useDeskAuth((s) => s.auth.status);
  const signIn = useDeskAuth((s) => s.signIn);
  const [gl, setGl] = useState<GL>("idle");
  const [hot, setHot] = useState<string | null>(null);
  useSceneReady(gl === "on" || gl === "off");
  useEffect(() => startInvoices(), []);

  const view = useMemo(() => boardView(load, status), [load, status]);

  // ---- the scene ----
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLElement>(null);
  const hud = useRef<HTMLElement>(null);
  const scene = useRef<Board | null>(null);
  const live = useRef(view);
  live.current = view;

  // ---- the tags: each rides its anchor; one that would cover a tag already placed is lifted above it ----
  const tags = useRef(new Map<string, HTMLElement>());
  const at = useRef(new Map<string, [number, number, boolean]>());
  const settle = useRef(0);
  const spread = () => {
    settle.current = 0;
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    // The headline's block: a tag that would sit over it steps away rather than cover the words.
    const hd = hud.current;
    const head = hd ? { l: hd.offsetLeft, r: hd.offsetLeft + hd.offsetWidth, t: hd.offsetTop, b: hd.offsetTop + hd.offsetHeight } : null;
    const order = [...tags.current.keys()].sort((a, b) => rank(a) - rank(b));
    for (const id of order) {
      const el = tags.current.get(id)!;
      const p = at.current.get(id);
      if (!p || !p[2]) {
        el.classList.add("is-away");
        continue;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // Kept inside the frame: a seat near the edge keeps its tag whole.
      const W = host.current?.clientWidth ?? 0;
      const x = W > w + 16 ? Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, p[0])) : p[0];
      let y = p[1];
      let ok = false;
      for (let k = 0; k < 6; k++) {
        const box = { l: x - w / 2 - 4, r: x + w / 2 + 4, t: y - h - 4, b: y + 4 };
        const hit = boxes.find((o) => o.l < box.r && box.l < o.r && o.t < box.b && box.t < o.b);
        if (!hit) {
          boxes.push(box);
          ok = true;
          break;
        }
        y = hit.t - 4;
      }
      const over = !!head && x - w / 2 < head.r && head.l < x + w / 2 && y - h < head.b && head.t < y;
      el.classList.toggle("is-away", !ok || over || y - h < 0);
      el.style.setProperty("--gx", `${Math.round(x)}px`);
      el.style.setProperty("--gy", `${Math.round(y)}px`);
    }
  };
  const respread = useRef(() => {});
  respread.current = () => {
    if (!settle.current) settle.current = requestAnimationFrame(spread);
  };
  const tagRef = (id: string) => (el: HTMLElement | null) => {
    if (!el) tags.current.delete(id);
    else {
      tags.current.set(id, el);
      if (at.current.size) respread.current();
    }
  };

  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!cv || !el) return;
    let dead = false;
    const start = () => {
      if (dead) return;
      setGl("loading");
      void import("./boardroomScene.ts")
        .then((m) => {
          if (!m.canDraw3D()) throw new Error("no WebGL");
          return m.createBoard(el, cv, {
            phone: isPhone(),
            reduce: reducedMotion(),
            view: live.current,
            inset: () => {
              const p = panel.current;
              return p && getComputedStyle(p).position === "absolute" ? p.offsetWidth + 24 : 0;
            },
            onPlace: (id, x, y, on) => {
              at.current.set(id, [x, y, on]);
              respread.current();
            },
          });
        })
        .then((s) => {
          if (dead) return s.dispose();
          scene.current = s;
          setGl("on");
        })
        .catch(() => !dead && setGl("off"));
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const viaIdle = typeof w.requestIdleCallback === "function";
    const idle = viaIdle ? w.requestIdleCallback!(start, { timeout: 600 }) : window.setTimeout(start, 120);
    return () => {
      dead = true;
      cancelAnimationFrame(settle.current);
      if (viaIdle) w.cancelIdleCallback?.(idle);
      else window.clearTimeout(idle);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  const sig = JSON.stringify(view);
  useEffect(() => {
    scene.current?.set(live.current);
  }, [sig, gl]);
  useEffect(() => {
    scene.current?.focus(hot);
  }, [hot, gl]);

  const flat = gl === "off";
  const hover = (id: string) => ({ onMouseEnter: () => setHot(id), onMouseLeave: () => setHot(null), onFocus: () => setHot(id), onBlur: () => setHot(null) });
  const counts = view.piles.length ? view.piles : null;

  return (
    <section className={`sp-board${flat ? " is-flat" : ""}`} data-gl={gl} aria-label="The boardroom at the top of the Spire: the invoices' counts on the table, the Spire's own seated round it">
      <div className="sp-board-stage">
        <div ref={host} className="sp-board-host">
          <canvas ref={canvas} className="sp-board-gl" aria-hidden="true" />
        </div>
        <div className="sp-board-veil" aria-hidden="true" />

        <header ref={hud} className="sp-hud">
          <p className="sp-eyb">
            <span>The Spire</span>
            <i aria-hidden="true" />
            the boardroom · PayPal
          </p>
          <h1 className="sp-h1 desk__title">
            The board is <em>{view.word}</em>.
          </h1>
          <p className="sp-say">{view.say}</p>
        </header>

        <div className="sp-foot-hud">
          <dl className="sp-counts" aria-label="Invoices, the newest fifty: counts only">
            {(counts ?? [
              { id: "drafts", label: "Drafts", n: null },
              { id: "open", label: "Open", n: null },
              { id: "overdue", label: "Overdue", n: null },
              { id: "paid", label: "Paid", n: null },
            ]).map((p) => (
              <div key={p.id} className={p.id === "overdue" && p.n ? "is-late" : p.id === "open" ? "is-hot" : undefined}>
                <dt>{p.label}</dt>
                <dd aria-label={p.n === null ? "not read yet" : String(p.n)}>{p.n === null ? "–" : p.n}</dd>
              </div>
            ))}
          </dl>
        </div>

        <ul className="sp-tags" aria-label="Round the table">
          {view.seats.map((s) => (
            <li key={s.id}>
              <button type="button" ref={tagRef(s.id)} className={`sp-tag is-seat${hot === s.id ? " is-hot" : ""}`} onClick={onInvoices} {...hover(s.id)}>
                <b>{s.name}</b>
                <span>{s.line}</span>
              </button>
            </li>
          ))}
          {view.piles.map((p) => (
            <li key={p.id}>
              <button type="button" ref={tagRef(`pile-${p.id}`)} className={`sp-tag is-pile is-${p.id}${hot === `pile-${p.id}` ? " is-hot" : ""}`} onClick={onInvoices} {...hover(`pile-${p.id}`)}>
                <b>{p.label}</b>
                <span>
                  <em>{p.n}</em> {p.n === 1 ? "folder" : "folders"}
                </span>
              </button>
            </li>
          ))}
          <li aria-hidden="true">
            <span ref={tagRef("easel")} className="sp-tag is-easel">
              <b>The easel</b>
              <span>
                {view.easel[0] !== "–" && <em>{view.easel[0]}</em>} {view.easel[1]}
              </span>
            </span>
          </li>
        </ul>
      </div>

      <aside ref={panel} className="sp-agenda" aria-label="The agenda">
        <header className="sp-agenda-h">
          <p className="sp-k">
            <span>The agenda</span> · today
          </p>
          <p className="sp-state" data-state={view.state}>
            <i aria-hidden="true" />
            {invoicesLine(load, status)}
            {view.mode && <b data-mode={view.mode}>{view.mode === "live" ? "Live PayPal" : "Sandbox"}</b>}
          </p>
        </header>
        <ol className="sp-items">
          <li>
            <span className="sp-item-n">I</span>
            <div>
              <b>Drafts for the C.E.O.'s Send</b>
              <p>{counts ? `${view.piles[0]!.n} ${view.piles[0]!.n === 1 ? "draft waits" : "drafts wait"}. Ledger checks each twice; only the C.E.O. presses Send, and says yes a second time.` : "Nothing on the table until PayPal answers."}</p>
            </div>
          </li>
          <li>
            <span className="sp-item-n">II</span>
            <div>
              <b>The open pipeline</b>
              <p>{counts ? `${view.piles[1]!.n} sent and unpaid${view.piles[2]!.n ? `, ${view.piles[2]!.n} past due` : ", none past due"}. The Executive keeps the count on its easel.` : "The easel stays blank rather than guessing."}</p>
            </div>
          </li>
          <li>
            <span className="sp-item-n">III</span>
            <div>
              <b>This week's best idea</b>
              <p>No idea this week yet: the scout isn't running.</p>
            </div>
          </li>
        </ol>
        <div className="sp-agenda-do">
          {load !== "off" && auth !== "in" && (
            <button type="button" className="wv-btn is-pri" onClick={() => void signIn()}>
              Sign in for the invoices
            </button>
          )}
          <button type="button" className="wv-btn" onClick={onInvoices}>
            {auth === "in" && load === "live" ? "Open the invoices" : "Down to the invoices"}
          </button>
        </div>
        <p className="sp-fine">Counts only, never a client or a sum: the same the Lattice sees.</p>
      </aside>
    </section>
  );
}

const rank = (id: string) => (id === "easel" ? 3 : id.startsWith("pile-") ? 2 : 1);
