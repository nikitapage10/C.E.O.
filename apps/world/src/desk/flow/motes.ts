/**
 * Cheap motes (#413, Nikita 21:34Z: "the Desk is still laggy"). A canvas pays per draw call far more than per pixel,
 * so only the bright, near particles get the soft glowing sprite; the small far ones are gathered into two runs of
 * tiny squares (a faint one and a brighter one), each run in one colour and alpha, which the canvas draws as a batch.
 */
export class Motes {
  private a: number[] = [];
  private b: number[] = [];
  /** Queue a small mote at x, y with side s; `bright` picks the brighter of the two fills. */
  add(x: number, y: number, s: number, bright: boolean) {
    (bright ? this.b : this.a).push(x - s / 2, y - s / 2, s);
  }
  /** Fill what was queued in one colour, at the two alphas (times `k`), and empty the queue. */
  flush(c: CanvasRenderingContext2D, rgb: string, k: number) {
    for (const [list, al] of [
      [this.a, 0.42],
      [this.b, 0.85],
    ] as const) {
      if (!list.length) continue;
      const A = al * k;
      if (A >= 0.03) {
        c.globalAlpha = A > 1 ? 1 : A;
        c.fillStyle = `rgb(${rgb})`;
        // Plain rects, one colour and alpha: the canvas batches these, where one path of hundreds of rects is slow.
        for (let i = 0; i < list.length; i += 3) c.fillRect(list[i]!, list[i + 1]!, list[i + 2]!, list[i + 2]!);
      }
      list.length = 0;
    }
    c.globalAlpha = 1;
  }
}

/** Depth at and above which a particle is drawn as a glowing sprite. */
export const NEAR = 0.5;
