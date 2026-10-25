# The flow kit

One particle-line language for every Desk page, taken from Today ("Confluence", #413) in #428. Nikita, 2026-10-24:
"the thing that you should always bring back is the particle lines." Relay, Exchange, Archive, the Foundry, the
Lattice map, Green and the Boiler Room build on this kit, so the Desk reads as one place.

## The rules

- **Every page leads with particle lines carrying real data.** The lines are how the page shows its data (volume is
  density, pace is rate, a moment is a knot or a pulse), not decoration in a corner.
- **Only the accent and one signature idea differ.** A page sets `--fl-accent` (its room colour) and has one idea of its
  own (Relay's letters filtering into the few that matter, the Exchange's lines fanning into bets). Type, horizon,
  eyebrow, ledger, panels and spacing come from here.
- **Real data only.** A source not connected yet is a `waiting` line (dashed, a few faint motes) and says so in plain
  type. Never invented values, never fake flow.
- **No corny props.** Suggest the room through structure, type and motion, never literal objects, textures or puns.
- **Clarity first.** Key facts in plain legible type over the stage; the lines frame them.
- **Public view:** rising words are neutral ("shipped #412", "3 links up"); a post's own words only through `safeTitle`
  and only when signed in with Hide off. No money, messages, contacts or keys.

## Using it

Import from `desk/flow/index.ts` in a page that is itself lazy (it brings the fonts and `flow.css` with it).

```tsx
import { fan, useFlow, RC, type FlowLayoutFn } from "../flow/index.ts";

const layout = useCallback<FlowLayoutFn>(({ W, H, phone, rel }) => ({
  // Read DOM positions here (rel(el)): it runs on mount, resize and relayout(), never per frame.
  lines: fan([40, H / 2], kinds.map((k, i) => [W - 40, (H * (i + 1)) / (kinds.length + 1)])).map((path, i) => ({
    id: kinds[i].id,
    path,                      // { from, to, bend } | { via } | { cubic } | sampled; fan() / converge() split and merge
    density: kinds[i].volume,  // 0..1, the real volume
    rate: 30 + kinds[i].perHour, // px/s, the real pace
    knots: kinds[i].moments,   // 0..1 along the line
    waiting: !kinds[i].connected,
    thin: { at: 0.6, keep: 0.1 }, // optional: a filter, past 60% only 10% go on
  })),
  anchors: { inbox: [W - 40, 40] }, // optional: named points words can rise from
}), [kinds]);

const { cv, field, bind } = useFlow(layout, { accent: RC.relay, ground: true, onHover, onPick });

<div className="wv-page fl-page" style={{ "--fl-accent": RC.relay } as React.CSSProperties}>
  <section className="fl-stage" {...bind}>
    <canvas ref={cv} className="fl-cv" aria-hidden="true" />
    <p className="fl-eyb"><span>Relay</span><i />Saturday</p>
    <h1 className="fl-h1">Three <em>need you</em></h1>
    <dl className="fl-ledger"><div><dt>In today</dt><dd>142</dd></div></dl>
  </section>
</div>
```

On live events: `field.pulse(id)` (a bright packet runs the line once), `field.burst(id, { u })` (a spray of grains),
`field.rise("shipped #412", { at: id })` (words rise off the line's end or an anchor and fall as sand),
`field.setFocus(id)` (others dim). `field.hit(x, y)` and `field.line(id)` for anything custom.

Options (`useFlow`, read once): `accent` ("r,g,b"), `ground` (paint the Desk's night with the accent's light and a dust
of stars: for a full-bleed stage), `backing` (cap backing pixels for a big soft stage; Today uses 650 000).

## CSS (`flow.css`, scoped to `.fl-page`)

Tokens: `--fl-accent` (set this), `--fl-gold`, `--fl-hi` (the accent, lightened), `--fl-disp` (Bodoni Moda),
`--fl-text` (Jost), `--fl-s1`..`--fl-s6` (4, 8, 14, 22, 34, 56 px), `--fl-pad` (the page gutter).
Classes: `fl-page` (edge to edge, steps out of the Desk's centred column), `fl-stage` (the stage, with the horizon
hairline), `fl-cv`, `fl-below`, `fl-eyb`, `fl-h1` (with `em`), `fl-h2`, `fl-say`, `fl-k`, `fl-num`, `fl-wait`,
`fl-ledger` (`dl` of `div > dt + dd`, `.is-hot`), `fl-panel`, `fl-btn` (`.is-pri`).

## What the kit takes care of

One canvas, drawn by the Desk's one shared loop (`wvCanvas.ts`, about 40 fps): paused when the tab is hidden, skipped
off screen, gone on unmount, devicePixelRatio capped at 2, one still frame under reduced motion (and no pulses,
bursts or rising words). No layout reads and no React in a frame. The lines' beds (and the ground) are a cached layer,
redrawn only on layout or focus. Counts: at most 240 particles a line and 2400 a field, fewer on a phone.

## Files

- `path.ts`: path maths (sampling, `fan`, `converge`, counts, filter, pulses, hit-testing), unit tested.
- `draw.ts`: `stream()`, the particle line itself (Today's stage draws its streams with it), and `knotAt()`.
- `field.ts`: `makeFlowField()`, the engine. `useFlow.ts`: the React hook.
- `rise.ts`: `RiseField` (rising words that fall as sand) and `safeTitle`. `motes.ts`: batched small motes.
- `flow.css`: the frame and type. `harness.html`/`harness.tsx`: dev server only, for `tests/e2e/flow.spec.ts`.
