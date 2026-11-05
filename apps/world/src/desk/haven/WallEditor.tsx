import { useMemo, useState } from "react";
import { centreOf, PLAN_NOTE, savePlan, type HavenPlan } from "./data.ts";
import { glassOf, setGlass, setTv, sideName, wallSides, type At, type Glass } from "./wallEdit.ts";

/**
 * The walls, one by one (#747): the home from above, every room's walls drawn by what they have (solid, windows, a
 * balcony door, the TV), tap one to set it. Saved to the private plan through the passkey session, like the import;
 * passkey only, since it draws the plan.
 */

const GLASS: { id: Glass; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "windows", label: "Windows" },
  { id: "door", label: "Balcony door" },
  { id: "both", label: "Windows + balcony door" },
];

export function WallEditor({ plan, onSaved }: { plan: HavenPlan; onSaved: (p: HavenPlan) => void }) {
  const [draft, setDraft] = useState<HavenPlan>(plan);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sides = useMemo(() => wallSides(draft), [draft]);
  const rooms = draft.rooms.filter((r) => !r.detached);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rooms)
    for (const [x, y, w, h] of r.parts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + w);
      y1 = Math.max(y1, y + h);
    }
  if (!Number.isFinite(x0)) return null;
  const pad = 24, fs = Math.max(x1 - x0, y1 - y0) / 26;
  const cur = sides.find((s) => s.key === pick) ?? null;
  const now = cur ? glassOf(draft, cur.seg) : null;
  const horiz = cur ? cur.seg[1] === cur.seg[3] : true;
  const AT: { id: At; label: string }[] = [
    { id: "start", label: horiz ? "Left" : "Top" },
    { id: "middle", label: "Middle" },
    { id: "end", label: horiz ? "Right" : "Bottom" },
  ];
  const dirty = draft !== plan;
  const set = (glass: Glass, at: At) => cur && setDraft((p) => setGlass(p, cur.seg, glass, at));
  const save = async () => {
    setBusy(true);
    setNote(null);
    const got = await savePlan(draft);
    setBusy(false);
    if (got.ok) {
      setDraft(got.plan);
      onSaved(got.plan);
      setNote("Saved. The house is drawn with these walls.");
    } else setNote(PLAN_NOTE[got.error] ?? PLAN_NOTE.failed!);
  };
  return (
    <details className="hv-import hv-walls">
      <summary>Windows, balcony doors and the TV wall</summary>
      <p className="hv-note">Tap a wall to set what it has. Walls with nothing set are drawn solid.</p>
      <svg className="hv-wallMap" viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`} role="group" aria-label="Walls on the floor plan">
        {rooms.map((r) => {
          const [cx, cy] = centreOf(r);
          return (
            <g key={r.id} className="hv-wallRoom">
              {r.parts.map(([x, y, w, h], i) => (
                <rect key={i} x={x} y={y} width={w} height={h} />
              ))}
              <text x={cx} y={cy} style={{ fontSize: fs }}>
                {r.name}
              </text>
            </g>
          );
        })}
        {sides.map((s) => {
          const g = glassOf(draft, s.seg);
          // Each wall drawn a little inside its room, so a shared wall shows both sides.
          const [ax, ay, bx, by] = s.seg;
          const ins = 7, dx = s.side === "w" ? ins : s.side === "e" ? -ins : 0, dy = s.side === "n" ? ins : s.side === "s" ? -ins : 0;
          return (
            <line
              key={s.key}
              x1={ax + dx + (ay === by ? ins : 0)}
              y1={ay + dy + (ax === bx ? ins : 0)}
              x2={bx + dx - (ay === by ? ins : 0)}
              y2={by + dy - (ax === bx ? ins : 0)}
              className={`hv-wallSeg is-${g.glass}${g.tv ? " is-tv" : ""}${pick === s.key ? " is-on" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${s.name}, ${sideName(s.side)} wall: ${g.glass === "both" ? "windows and a balcony door" : g.glass === "door" ? "a balcony door" : g.glass}${g.tv ? ", TV" : ""}`}
              aria-pressed={pick === s.key}
              onClick={() => setPick(s.key)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setPick(s.key))}
            />
          );
        })}
      </svg>
      {cur && now && (
        <div className="hv-wallPick" role="group" aria-label={`${cur.name}, ${sideName(cur.side)} wall`}>
          <p className="hv-note">
            <b>{cur.name}</b>, {sideName(cur.side)} wall · {cur.outside ? "outside" : "inside"}
          </p>
          <div className="hv-btns">
            {GLASS.map((o) => (
              <button key={o.id} type="button" className="hv-btn" aria-pressed={now.glass === o.id} onClick={() => set(o.id, now.at)}>
                {o.label}
              </button>
            ))}
          </div>
          {(now.glass === "door" || now.glass === "both") && (
            <div className="hv-btns" role="group" aria-label="Where the balcony door is">
              {AT.map((o) => (
                <button key={o.id} type="button" className="hv-btn" aria-pressed={now.at === o.id} onClick={() => set(now.glass, o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {!cur.outside && (
            <label className="hv-wallTv">
              <input
                type="checkbox"
                checked={now.tv}
                onChange={(e) => setDraft((p) => setTv(p, cur.seg, e.target.checked, sides.filter((s) => s.room === cur.room && s.key !== cur.key).map((s) => s.seg)))}
              />
              The TV hangs on this wall
            </label>
          )}
        </div>
      )}
      <div className="hv-btns">
        <button type="button" className="hv-btn is-pri" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save the walls"}
        </button>
        <button type="button" className="hv-btn" disabled={busy || !dirty} onClick={() => setDraft(plan)}>
          Undo changes
        </button>
      </div>
      {note && (
        <p className="hv-note" role="status">
          {note}
        </p>
      )}
    </details>
  );
}
