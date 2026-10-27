import type { Expression } from "./signal.ts";

/**
 * Skippy's face on a call (#481), drawn on a 1024×512 canvas that wraps the front of his head (holoScene.ts). The
 * model's own face is painted into its texture, so this redraws it in the same style (almond eyes under a heavy lash
 * line, big dark irises, thick brows) and lets it move: the brows, lids and mouth follow his expression and the mouth
 * opens with his voice (`open`, 0 to 1).
 */
export const FACE_W = 1024;
export const FACE_H = 512;

const SKIN = "#e3e7ee";
const INK = "#11141c";
const EX = [340, 684] as const;
const EY = 212;

type Ctx = CanvasRenderingContext2D;

function base(g: Ctx) {
  g.clearRect(0, 0, FACE_W, FACE_H);
  // Opaque in the middle to cover the painted face, fading out at the edges so the seam never shows.
  const gr = g.createRadialGradient(512, 256, 120, 512, 256, 470);
  gr.addColorStop(0, SKIN);
  gr.addColorStop(0.78, SKIN);
  gr.addColorStop(1, "rgba(227,231,238,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, FACE_W, FACE_H);
}

function eye(g: Ctx, x: number, look: readonly [number, number], lid: number, sy = 1) {
  g.save();
  g.translate(x, EY);
  g.scale(1.55, 1.45 * sy);
  const almond = () => {
    g.beginPath();
    g.moveTo(-58, 4);
    g.bezierCurveTo(-40, -52, 40, -52, 58, 0);
    g.bezierCurveTo(40, 46, -40, 46, -58, 4);
    g.closePath();
  };
  almond();
  g.fillStyle = "#fbfcff";
  g.fill();
  g.save();
  almond();
  g.clip();
  g.fillStyle = "#0d1018";
  g.beginPath();
  g.ellipse(look[0], look[1] + 2, 30, 34, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(look[0] + 11, look[1] - 12, 8, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(look[0] - 10, look[1] + 12, 3.5, 0, Math.PI * 2);
  g.fill();
  if (lid > 0) {
    g.fillStyle = SKIN;
    g.fillRect(-70, -60, 140, 100 * lid);
  }
  g.restore();
  g.strokeStyle = INK;
  g.lineCap = "round";
  g.lineWidth = 11;
  g.beginPath();
  g.moveTo(-62, 6 + lid * 20);
  g.quadraticCurveTo(0, -52 + 82 * lid, 62, lid * 18);
  g.stroke();
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(-50, 14);
  g.bezierCurveTo(-30, 42, 30, 42, 52, 8);
  g.stroke();
  g.restore();
}

/** A closed, happy eye: ^ */
function arcEye(g: Ctx, x: number) {
  g.save();
  g.strokeStyle = INK;
  g.lineWidth = 24;
  g.lineCap = "round";
  g.beginPath();
  g.arc(x, EY + 44, 78, Math.PI * 1.18, Math.PI * 1.82);
  g.stroke();
  g.restore();
}

/** A thick brow, heavier toward the middle like the painted ones. */
function brow(g: Ctx, x: number, angle: number, dy: number, w = 70) {
  const side = x < 512 ? -1 : 1;
  g.save();
  g.translate(x, EY - 112 + dy);
  g.rotate(angle);
  g.scale(1.6 * side, 1.3);
  g.fillStyle = "#151821";
  g.beginPath();
  g.moveTo(-w / 2, 2);
  g.quadraticCurveTo(0, -20, w / 2, -10);
  g.lineTo(w / 2 - 2, 6);
  g.quadraticCurveTo(0, 2, -w / 2, 26);
  g.closePath();
  g.fill();
  g.restore();
}

function mouth(g: Ctx, draw: () => void) {
  g.save();
  g.translate(512, 330);
  g.scale(1.35, 1.35);
  g.strokeStyle = "#151821";
  g.fillStyle = "#2a1d24";
  g.lineWidth = 13;
  g.lineCap = "round";
  g.lineJoin = "round";
  draw();
  g.restore();
}

/** An open mouth, `h` tall, leaning `lean` toward his right for the smirk. */
function openMouth(g: Ctx, w: number, h: number, lean = 0) {
  g.beginPath();
  g.moveTo(-w, -lean);
  g.quadraticCurveTo(0, -h * 0.35, w, lean - 4);
  g.quadraticCurveTo(w * 0.8, h, 0, h);
  g.quadraticCurveTo(-w * 0.8, h, -w, -lean);
  g.closePath();
  g.fill();
  g.stroke();
}

/** Draws his face for an expression with the mouth `open` (0 shut, 1 wide). */
export function drawFace(g: Ctx, expr: Expression, open: number) {
  const o = Math.max(0, Math.min(1, open));
  base(g);
  const [l, r] = EX;
  switch (expr) {
    case "listening":
      eye(g, l, [0, -4], 0);
      eye(g, r, [0, -4], 0);
      brow(g, l, -0.08, -14);
      brow(g, r, 0.08, -14);
      mouth(g, () => {
        g.beginPath();
        g.moveTo(-40, 0);
        g.quadraticCurveTo(0, 14, 40, 0);
        g.stroke();
      });
      break;
    case "thinking":
      eye(g, l, [16, -14], 0);
      eye(g, r, [16, -14], 0);
      brow(g, l, 0.1, 6);
      brow(g, r, -0.25, -26);
      mouth(g, () => {
        g.beginPath();
        g.moveTo(-10, 4);
        g.quadraticCurveTo(25, -8, 44, 2);
        g.stroke();
      });
      break;
    case "smug":
      eye(g, l, [-8, 6], 0.45);
      eye(g, r, [-8, 6], 0.45);
      brow(g, l, 0.18, 8);
      brow(g, r, -0.28, -22);
      mouth(g, () => {
        if (o < 0.12) {
          g.beginPath();
          g.moveTo(-46, 4);
          g.quadraticCurveTo(10, 14, 50, -22);
          g.stroke();
        } else openMouth(g, 42, 12 + 40 * o, 14);
      });
      break;
    case "laughing":
      arcEye(g, l);
      arcEye(g, r);
      brow(g, l, -0.15, -26);
      brow(g, r, 0.15, -26);
      mouth(g, () => {
        const h = 50 + 34 * o;
        g.beginPath();
        g.moveTo(-62, -12);
        g.quadraticCurveTo(0, -4, 62, -12);
        g.quadraticCurveTo(52, h, 0, h + 2);
        g.quadraticCurveTo(-52, h, -62, -12);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = "#c95a6a";
        g.beginPath();
        g.ellipse(0, h - 26, 26, 14, 0, 0, Math.PI * 2);
        g.fill();
      });
      break;
    case "annoyed":
      eye(g, l, [8, 4], 0.3, 0.9);
      eye(g, r, [-8, 4], 0.3, 0.9);
      brow(g, l, 0.42, 18, 80);
      brow(g, r, -0.42, 18, 80);
      mouth(g, () => {
        if (o < 0.12) {
          g.beginPath();
          g.moveTo(-42, 10);
          g.lineTo(-14, -2);
          g.lineTo(14, 4);
          g.lineTo(42, -4);
          g.stroke();
        } else openMouth(g, 36, 8 + 26 * o, -4);
      });
      break;
  }
}
