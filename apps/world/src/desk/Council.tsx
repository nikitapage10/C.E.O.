import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { navigateTo } from "../route.ts";
import { portrait } from "./deskData.ts";
import type { PulseState, RoomPulse } from "./roomPulse.ts";
import { SKIPPY_PORTRAIT } from "./skippy/index.ts";

/**
 * The Council (Nikita, 2026-10-22): Skippy, the Magnificent with his nine subminds around him, each giving a short
 * report on its room. Takes no space until asked for: a small control near Skippy on Today; a click opens the
 * Council, Escape or the close button folds it away. Reports come from roomPulse.ts (real data, plain templates);
 * the rooms with nothing real connected say so in their own voice.
 */

const STATE_LABEL: Record<PulseState, string> = { busy: "Busy", steady: "Steady", waiting: "Waiting", down: "Needs a look", sim: "Simulated" };

export function Council({ pulses, open, onClose }: { pulses: RoomPulse[]; open: boolean; onClose: () => void }) {
  const [focus, setFocus] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const back = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (back.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const real = pulses.filter((p) => p.real);
  const count = pulses.length;
  // Drawn at the Desk's root, so no animated section around the control can trap or clip it.
  return createPortal(
    <div className="council" role="dialog" aria-modal="true" aria-label="The Council: each room's rundown" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="council__panel">
        <header className="council__head">
          <div>
            <p className="eyebrow">The Council</p>
            <h2>Skippy and his nine</h2>
            <p className="council__lead">
              Each room's submind, reporting in. {real.length} of {count} rooms run real work today; the rest are still simulated, and they'll tell you so.
            </p>
          </div>
          <button ref={closeRef} type="button" className="council__close" onClick={onClose} aria-label="Close the Council">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5 5 15" />
            </svg>
          </button>
        </header>
        <div className="council__body">
          <div className="council__ring" aria-hidden="true">
            <svg viewBox="-150 -150 300 300" className="council__threads">
              {pulses.map((p, i) => {
                const a = (i / count) * Math.PI * 2 - Math.PI / 2;
                const x = Math.cos(a) * 112;
                const y = Math.sin(a) * 112;
                const cx = Math.cos(a + 0.5) * 50;
                const cy = Math.sin(a + 0.5) * 50;
                return (
                  <path
                    key={p.id}
                    d={`M0 0 Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`}
                    style={{ "--c": p.colour, "--i": i } as React.CSSProperties}
                    className={`council__thread ${p.real ? "real" : ""} ${focus && focus !== p.id ? "dim" : ""} ${focus === p.id ? "on" : ""}`}
                    pathLength={1}
                  />
                );
              })}
            </svg>
            <span className="council__skippy">
              <img src={SKIPPY_PORTRAIT} alt="" width={96} height={96} decoding="async" />
            </span>
            {pulses.map((p, i) => {
              const a = (i / count) * Math.PI * 2 - Math.PI / 2;
              const src = portrait(p.submind.id);
              return (
                <span
                  key={p.id}
                  className={`council__mind ${focus && focus !== p.id ? "dim" : ""} ${focus === p.id ? "on" : ""}`}
                  style={{ "--c": p.colour, "--x": `${(Math.cos(a) * 37.3).toFixed(2)}%`, "--y": `${(Math.sin(a) * 37.3).toFixed(2)}%`, "--i": i } as React.CSSProperties}
                >
                  {src ? <img src={src} alt="" decoding="async" /> : <b>{p.submind.title.charAt(4)}</b>}
                </span>
              );
            })}
          </div>
          <ol className="council__reports">
            {pulses.map((p, i) => (
              <li
                key={p.id}
                className={`council__report council__report--${p.state}`}
                style={{ "--c": p.colour, "--i": i } as React.CSSProperties}
                onMouseEnter={() => setFocus(p.id)}
                onMouseLeave={() => setFocus(null)}
              >
                <button
                  type="button"
                  onFocus={() => setFocus(p.id)}
                  onBlur={() => setFocus(null)}
                  onClick={() => {
                    onClose();
                    navigateTo(p.href);
                  }}
                >
                  <span className="council__who">
                    <i aria-hidden="true" />
                    <b>{p.submind.title}</b>
                    <span>{p.name}</span>
                    <em>{STATE_LABEL[p.state]}</em>
                  </span>
                  <span className="council__line">{p.report}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>,
    document.querySelector(".desk") ?? document.body,
  );
}
