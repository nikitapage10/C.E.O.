import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { UndoneField } from "@ceo/engine/sigils/UndoneField.tsx";
import type { DeckFrame } from "@ceo/engine/sigils/deckCanvas.ts";
import "./codex.css";

/**
 * Under the Thread (#977): the codex sits on the mast's own deck, the way the Foundry's, the Workshop's, the Annex's and
 * the Studio's sections sit on theirs (#932). Relay keeps its blue: the shared wire in Messenger blue with white
 * nanites rising out of it (UndoneField), and under them the mast's signal going out, rings spreading from the spine
 * where the Thread's light runs down. The panels over it (codex.css) carry the same counts and lists as before.
 *
 * Kept apart from the Thread (RelayThread.tsx, thread.css), which renders the codex: the canvas is laid into the codex
 * once it's on the page, and follows it if it is drawn again.
 */

const BLUE = "134,182,255";
const WIRE = "96,140,230";
const WHITE = "236,238,246";

/** Where the Thread's spine runs (thread.css `--spine`): a third of the way in on a wide screen, by the edge below 1100px. */
const spineOf = (w: number) => (w > 1100 ? Math.max(0.36 * w, w / 2 - 230) : 26);

function signal({ c, w, h, t, phone }: DeckFrame) {
  const x = spineOf(w);
  const most = Math.hypot(Math.max(x, w - x), h);
  const period = 7;
  const n = phone ? 3 : 5;
  c.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const k = ((t / period + i / n) % 1 + 1) % 1;
    const r = 40 + k * most * 0.75;
    const a = 0.16 * (1 - k) * Math.min(1, k * 8);
    if (a < 0.01) continue;
    c.strokeStyle = `rgba(${BLUE},${a.toFixed(3)})`;
    c.setLineDash(k > 0.45 ? [6, 6 + k * 14] : []);
    c.beginPath();
    c.arc(x, 0, r, 0, Math.PI);
    c.stroke();
  }
  c.setLineDash([]);
  // The spine's foot glow, where the signal leaves.
  const g = c.createRadialGradient(x, 0, 0, x, 0, 160);
  g.addColorStop(0, `rgba(${BLUE},0.18)`);
  g.addColorStop(1, `rgba(${BLUE},0)`);
  c.fillStyle = g;
  c.fillRect(x - 160, 0, 320, 160);
}

const TONE = { wire: WIRE, glyph: WHITE, hi: "255,255,255" };

export function CodexDeck() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => {
      const el = document.getElementById("cx-codex");
      setHost((h) => (h === el ? h : el));
    };
    find();
    const mo = new MutationObserver(find);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return host ? createPortal(<UndoneField className="cx-deck-sig" tone={TONE} under={signal} most={[120, 40]} />, host) : null;
}
