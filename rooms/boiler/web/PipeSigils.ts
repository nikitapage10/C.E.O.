import type { DeckFrame } from "@ceo/engine/sigils/deckCanvas.ts";

/**
 * The Boiler Room's own iron under its deck (#977), laid between the shared gold wire and its nanites (UndoneField's
 * `under`): a few brass pipe runs crossing the deck with flanges at their joints, a pulse of heat travelling along each
 * the way the Map's lines carry their light, and the odd wisp of steam off a joint. Faint, and toward the sides, so
 * the plates over it stay easy to read. The room's look only: the cards over it carry the facts.
 */

const GOLD = "201,168,92";
const EMBER = "255,154,42";

type Wisp = { x: number; y: number; t: number; v: number };
const wisps: Wisp[] = [];

export function boilerPipes({ c, w, h, t, dt, phone }: DeckFrame) {
  const runs = phone ? [0.22, 0.58] : [0.16, 0.42, 0.7, 0.9];
  c.lineCap = "round";
  runs.forEach((k, i) => {
    const y = Math.round(h * k) + 0.5;
    const side = (x: number) => Math.min(1, Math.abs(x / w - 0.5) * 2);
    // The pipe: a dark tube with a gold highlight along its top, brighter toward the sides.
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, `rgba(${GOLD},0.2)`);
    g.addColorStop(0.35, `rgba(${GOLD},0.05)`);
    g.addColorStop(0.65, `rgba(${GOLD},0.05)`);
    g.addColorStop(1, `rgba(${GOLD},0.2)`);
    c.strokeStyle = "rgba(0,0,0,0.5)";
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
    c.strokeStyle = g;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, y - 3);
    c.lineTo(w, y - 3);
    c.moveTo(0, y + 3);
    c.lineTo(w, y + 3);
    c.stroke();
    // Flanges at the joints, every so often, offset run by run.
    const joint = phone ? 140 : 220;
    for (let x = ((i * 97) % joint) + 30; x < w; x += joint) {
      const a = 0.08 + side(x) * 0.22;
      c.fillStyle = `rgba(${GOLD},${a.toFixed(3)})`;
      c.fillRect(x - 2, y - 7, 4, 14);
      c.fillRect(x + 4, y - 7, 2, 14);
      // A wisp of steam now and then off a joint near the sides.
      if (dt > 0 && side(x) > 0.5 && Math.random() < 0.004) wisps.push({ x: x + 2, y: y - 8, t: 0, v: 8 + Math.random() * 10 });
    }
    // The heat pulse travelling the run, ember at its heart.
    const dir = i % 2 ? -1 : 1;
    const px = ((((t * (40 + i * 9)) / w + i * 0.31) % 1) + 1) % 1;
    const x = dir > 0 ? px * w : (1 - px) * w;
    const pg = c.createLinearGradient(x - 90 * dir, 0, x, 0);
    pg.addColorStop(0, `rgba(${EMBER},0)`);
    pg.addColorStop(1, `rgba(${EMBER},${(0.18 + side(x) * 0.2).toFixed(3)})`);
    c.strokeStyle = pg;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x - 90 * dir, y);
    c.lineTo(x, y);
    c.stroke();
  });
  // The steam: soft puffs rising and thinning.
  for (let i = wisps.length - 1; i >= 0; i--) {
    const s = wisps[i]!;
    s.t += dt;
    s.y -= s.v * dt;
    if (s.t > 3 || wisps.length > 40) {
      wisps.splice(i, 1);
      continue;
    }
    const r = 4 + s.t * 7;
    const a = 0.07 * (1 - s.t / 3);
    const sg = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    sg.addColorStop(0, `rgba(236,232,220,${a.toFixed(3)})`);
    sg.addColorStop(1, "rgba(236,232,220,0)");
    c.fillStyle = sg;
    c.fillRect(s.x - r, s.y - r, r * 2, r * 2);
  }
}
