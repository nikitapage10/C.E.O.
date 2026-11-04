import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDeskAuth } from "../signin.ts";
import {
  DAY_NAME,
  DAYS,
  PORTIONS,
  SPICES,
  allComponents,
  dayProtein,
  loadMeals,
  mealNamed,
  mealsAction,
  MEALS_NOTE,
  portionsOf,
  preview,
  shopLine,
  shoppingList,
  slotDish,
  statusOf,
  type Day,
  type Dish,
  type Meal,
  type MealEdit,
  type MealStatus,
  type MealsAction,
  type MealsFile,
  type Role,
  type Slot,
} from "./meals.ts";
import { confirmPhotos, PHOTO_WORD, photoStates, photoUrl, shootOf, type PhotoState } from "./mealPhotos.ts";
import { onWrote, touchesList, touchesMeals } from "../skippy/wrote.ts";
import "./meals.css";

/**
 * The Kitchen's meal planner (#678): the week as a strip of seven day cards (the dinner's photo, its protein ring
 * against the goal), a drawer for the night that's open (the recipe, swaps for each part, portion and spice, the
 * night's switches, the backups, Not for me), the week's shopping recomputed as it changes, and Confirm week, which
 * puts the shopping on the Kitchen list for the King Soopers rail beside it. The catalog and the taste profile open
 * as drawers over it. Every change is one edit of the closed set the server runs (api/_haven/mealShape.ts), shown at
 * once and replaced by the server's answer; Skippy makes the same edits when Nikita talks to him (#698), and the page reads itself again when he does.
 */

const ROLE_NAME: Record<Role, string> = {
  protein: "Protein",
  carb: "Carb",
  side: "Side",
};
const SHORT: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const STATUS_NAME: Record<MealStatus, string> = {
  week: "This week",
  backup: "Backup",
  new: "New",
  had: "Had",
  passed: "Passed on",
  avoid: "Avoided",
};
const PORTION_NAME: Record<number, string> = {
  0.75: "¾",
  1: "1",
  1.25: "1¼",
  1.5: "1½",
};

const dateOf = (start: string, i: number) => new Date(Date.parse(`${start}T12:00:00Z`) + i * 86_400_000);
const weekLabel = (start: string) => {
  const a = dateOf(start, 0),
    b = dateOf(start, 6);
  const m = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${m(a)} ${a.getUTCDate()} – ${m(a) === m(b) ? "" : `${m(b)} `}${b.getUTCDate()}`;
};
/** A warm hue per cuisine, for the placeholder when a meal has no photo yet. */
const hueOf = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 17);

/** The protein ring: the day's total against the goal. */
function Ring({ value, goal, size = 46 }: { value: number; goal: number; size?: number }) {
  const r = 18,
    c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, value / Math.max(1, goal)));
  return (
    <span className={`mp-ring${value >= goal ? " is-met" : ""}`} style={{ width: size, height: size }} role="img" aria-label={`${value} of ${goal} g protein`}>
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r={r} className="mp-ringBg" />
        <circle cx="22" cy="22" r={r} className="mp-ringFg" strokeDasharray={`${c * p} ${c}`} />
      </svg>
      <b>{value}</b>
    </span>
  );
}

/** The photo library's states for the nights' own photos (#687), polled while any is being made. */
const PhotoStates = createContext<ReadonlyMap<string, PhotoState>>(new Map());

/**
 * A meal's photo from the library (#687, `photoUrl`): a night's own once it's ready, else the meal's, else a quiet
 * placeholder in the cuisine's colour. A customized night says "photo pending" until the week is confirmed, then
 * where its own photo is ("making the photo", "photo cap reached").
 */
function Photo({ meal, photo, pending, className }: { meal: Meal; photo?: string | null; pending?: boolean; className?: string }) {
  const states = useContext(PhotoStates);
  const own = photo ? (states.get(photo) ?? "queued") : null;
  const id = photo && own === "ready" ? photo : meal.photo;
  const src = id ? photoUrl(id) : null;
  const [broken, setBroken] = useState<string | null>(null);
  const style = {
    ["--mp-hue" as string]: String(hueOf(meal.cuisine)),
  } as CSSProperties;
  const word = own ? PHOTO_WORD[own] : pending ? "photo pending" : null;
  return (
    <span className={`mp-photo${className ? ` ${className}` : ""}`} style={style}>
      {src && broken !== src ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(src)} />
      ) : (
        <span className="mp-ph" aria-hidden="true">
          <i />
          <em>{meal.cuisine}</em>
        </span>
      )}
      {word ? <span className="mp-pend">{word}</span> : null}
    </span>
  );
}

function DayCard({ f, s, i, open, onOpen }: { f: MealsFile; s: Slot; i: number; open: boolean; onOpen: () => void }) {
  const d = slotDish(f, s);
  const p = dayProtein(f, s);
  if (!d) return null;
  const pending = d.customized && !s.photo && !s.helloFresh;
  return (
    <li className={`mp-day${open ? " is-open" : ""}${s.helloFresh ? " is-hf" : ""}`} style={{ ["--i" as string]: i } as CSSProperties}>
      <button type="button" aria-pressed={open} aria-label={`${DAY_NAME[s.day]}: ${s.helloFresh ? "HelloFresh" : d.meal.name}, ${p.total} g protein`} onClick={onOpen}>
        <Photo meal={d.meal} photo={s.photo} pending={pending} />
        <span className="mp-dayTags">
          {s.helloFresh ? <span className="mp-tag is-hf">HelloFresh</span> : null}
          {s.forTwo ? <span className="mp-tag">for two</span> : null}
          {d.customized && !s.helloFresh ? <span className="mp-tag is-cu">custom</span> : null}
        </span>
        <span className="mp-dayFoot">
          <span className="mp-dayTxt">
            <small>
              {SHORT[s.day]} · {dateOf(f.week!.start, i).getUTCDate()}
            </small>
            <b>{s.helloFresh ? "HelloFresh night" : d.meal.name}</b>
          </span>
          <Ring value={p.total} goal={f.profile.proteinGoal} />
        </span>
      </button>
    </li>
  );
}

function Macros({ d }: { d: Dish }) {
  return (
    <div className="mp-macros">
      <span className="is-p">
        <b>{d.macros.protein}</b> g protein
      </span>
      <span>
        <b>{d.macros.carbs}</b> g carbs
      </span>
      <span>
        <b>{d.macros.fat}</b> g fat
      </span>
      <span>
        <b>{d.macros.kcal}</b> kcal
      </span>
    </div>
  );
}

function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" className="mp-toggle" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}>
      <i aria-hidden="true" />
      {label}
    </button>
  );
}

/** The open night: the recipe as cooked, its parts to swap, portion and spice, the night's switches and the backups. */
function Drawer({ f, s, edit }: { f: MealsFile; s: Slot; edit: (e: MealEdit) => void }) {
  const d = slotDish(f, s)!;
  const p = dayProtein(f, s);
  const day = s.day;
  const comps = allComponents(f);
  const portions = portionsOf(f.week!)[DAYS.indexOf(day)]!;
  const [recipe, setRecipe] = useState(false);
  return (
    <section className="mp-drawer" key={`${day}-${d.meal.id}`} aria-label={`${DAY_NAME[day]}'s dinner`}>
      <div className="mp-dHead">
        <Photo meal={d.meal} photo={s.photo} pending={d.customized && !s.photo && !s.helloFresh} className="is-big" />
        <div className="mp-dTxt">
          <p className="mp-eyb">
            {DAY_NAME[day]} · {d.meal.cuisine} · {d.meal.minutes} min
          </p>
          <h3>{d.meal.name}</h3>
          <p className="mp-blurb">{d.meal.blurb}</p>
          {d.customized ? <p className="mp-changes">{d.changes.join(" · ")}</p> : null}
          <Macros d={d} />
          <div className="mp-dayLine">
            <span>
              Dinner {p.dinner} g{s.helloFresh ? " (HelloFresh)" : ""} · {s.lunch.text} {p.lunch} g · {f.profile.topUp.text} {p.topUp} g
            </span>
            <b className={p.total >= f.profile.proteinGoal ? "is-ok" : "is-low"}>
              {p.total} / {f.profile.proteinGoal} g
            </b>
          </div>
          <div className="mp-toggles">
            <Toggle on={s.helloFresh} label="HelloFresh" onChange={(v) => edit({ op: "night", day, helloFresh: v })} />
            <Toggle on={s.forTwo} label="For two" onChange={(v) => edit({ op: "night", day, forTwo: v })} />
            <Toggle on={s.inCart} label="In the cart" disabled={s.helloFresh} onChange={(v) => edit({ op: "night", day, inCart: v })} />
          </div>
        </div>
      </div>

      {s.helloFresh ? (
        <p className="mp-note">
          HelloFresh covers {DAY_NAME[day]}: nothing to cook or buy. The plan keeps {d.meal.name} here for a cook-yourself week.
        </p>
      ) : (
        <div className="mp-custom">
          {d.parts.map((part) => (
            <div key={part.index} className="mp-part">
              <span className="mp-k">{ROLE_NAME[part.role]}</span>
              <div className="mp-chips" role="group" aria-label={`${ROLE_NAME[part.role]} for ${DAY_NAME[day]}`}>
                {comps
                  .filter((c) => c.role === part.role)
                  // What's on the plate first, then the recipe's own, then the rest: no hunting along the row.
                  .sort((x, y) => Number(y.id === part.now?.id) - Number(x.id === part.now?.id) || Number(y.id === part.base?.id) - Number(x.id === part.base?.id))
                  .map((c) => {
                    const delta = c.macros.protein - (part.now?.macros.protein ?? 0);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className="mp-chip"
                        aria-pressed={part.now?.id === c.id}
                        onClick={() =>
                          edit({
                            op: "customize",
                            day,
                            part: { index: part.index, option: c.id },
                          })
                        }
                      >
                        {c.name}
                        {part.now?.id !== c.id && delta !== 0 ? <small className={delta > 0 ? "is-up" : "is-down"}>{delta > 0 ? `+${delta}` : delta} g</small> : null}
                        {part.base?.id === c.id && part.now?.id !== c.id ? <small>as written</small> : null}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
          <div className="mp-part is-row">
            <span className="mp-k">Portion</span>
            <div className="mp-chips" role="group" aria-label={`Portion for ${DAY_NAME[day]}`}>
              {PORTIONS.map((n) => (
                <button key={n} type="button" className="mp-chip" aria-pressed={d.portion === n} onClick={() => edit({ op: "customize", day, portion: n })}>
                  {PORTION_NAME[n]}
                </button>
              ))}
            </div>
            <span className="mp-k">Spice</span>
            <div className="mp-chips" role="group" aria-label={`Spice for ${DAY_NAME[day]}`}>
              {SPICES.map((sp) => (
                <button key={sp} type="button" className="mp-chip" aria-pressed={d.spice === sp} onClick={() => edit({ op: "customize", day, spice: sp })}>
                  {sp}
                </button>
              ))}
            </div>
            {d.customized ? (
              <button type="button" className="mp-link" onClick={() => edit({ op: "customize", day, reset: true })}>
                As written
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div className="mp-swap">
        <span className="mp-k">Backups</span>
        <div className="mp-backs">
          {s.backups.map((id) => {
            const m = mealNamed(f, id);
            return m ? (
              <button key={id} type="button" className="mp-back" onClick={() => edit({ op: "swap", day, meal: id })}>
                <Photo meal={m} className="is-mini" />
                <span>
                  <b>{m.name}</b>
                  <small>
                    {m.cuisine} · {m.macros.protein} g protein
                  </small>
                </span>
              </button>
            ) : null;
          })}
          <button type="button" className="mp-nope" onClick={() => edit({ op: "nope", day })}>
            Not for me
          </button>
        </div>
      </div>

      <button type="button" className="mp-link" aria-expanded={recipe} onClick={() => setRecipe((v) => !v)}>
        {recipe ? "Hide the recipe" : `Recipe and ingredients (cooked for ${portions})`}
      </button>
      {recipe ? (
        <div className="mp-recipe">
          <ol>
            {d.meal.steps.map((st, i) => (
              <li key={i}>{st}</li>
            ))}
          </ol>
          <ul aria-label="Ingredients, one portion">
            {d.ingredients.map((x, i) => (
              <li key={i} className={x.pantry ? "is-pantry" : ""}>
                {shopLine({ ...x, qty: x.qty * d.portion })}
                {x.pantry ? <small> pantry</small> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** A drawer over the planner: the catalog or the taste profile. */
function Over({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    // Escape closes this drawer only, not the Kitchen under it (HavenPage listens on window too, after this).
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  return (
    // On the page's body, so no transformed ancestor (the sheet's entrance) can hold it; the room's scope comes along.
    createPortal(
      <div data-room="haven" className="mp-portal">
        <div className="mp-over" role="dialog" aria-modal="true" aria-label={title}>
          <button type="button" className="mp-overBg" aria-label="Close" onClick={onClose} />
          <div className="mp-overIn">
            <header>
              <h3>{title}</h3>
              <button type="button" className="hv-back" onClick={onClose}>
                Close
              </button>
            </header>
            {children}
          </div>
        </div>
      </div>,
      document.body,
    )
  );
}

const ORDER: MealStatus[] = ["week", "backup", "new", "had", "avoid", "passed"];

function Catalog({ f, day, edit }: { f: MealsFile; day: Day; edit: (e: MealEdit) => void }) {
  const rows = [...f.catalog].map((m) => ({ m, st: statusOf(f, m) })).sort((a, b) => ORDER.indexOf(a.st) - ORDER.indexOf(b.st) || a.m.name.localeCompare(b.m.name));
  return (
    <div className="mp-cat">
      <p className="mp-note">
        {f.catalog.length} meals. Macros are estimates for one portion. "Put on" swaps it in for {DAY_NAME[day]}.
      </p>
      <table>
        <thead>
          <tr>
            <th aria-label="Photo" />
            <th>Meal</th>
            <th>Protein</th>
            <th className="is-x">Carbs</th>
            <th className="is-x">Fat</th>
            <th className="is-x">kcal</th>
            <th>Had</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ m, st }) => (
            <tr key={m.id} className={`is-${st}`}>
              <td>
                <Photo meal={m} className="is-thumb" />
              </td>
              <td>
                <b>{m.name}</b>
                <small>
                  {m.cuisine} · {m.minutes} min
                </small>
              </td>
              <td className="mp-num">{m.macros.protein} g</td>
              <td className="mp-num is-x">{m.macros.carbs} g</td>
              <td className="mp-num is-x">{m.macros.fat} g</td>
              <td className="mp-num is-x">{m.macros.kcal}</td>
              <td className="mp-num">{m.timesHad}×</td>
              <td>
                <span className={`mp-st is-${st}`}>{STATUS_NAME[st]}</span>
              </td>
              <td className="mp-acts">
                {st !== "passed" && st !== "avoid" && st !== "week" ? (
                  <button type="button" className="mp-link" onClick={() => edit({ op: "swap", day, meal: m.id })}>
                    Put on {SHORT[day]}
                  </button>
                ) : null}
                <button type="button" className="mp-link is-quiet" onClick={() => edit({ op: "pass", meal: m.id, passed: !m.passed })}>
                  {m.passed ? "Bring back" : "Pass"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Taste({ f, edit }: { f: MealsFile; edit: (e: MealEdit) => void }) {
  const [term, setTerm] = useState("");
  const [unless, setUnless] = useState("");
  const goal = f.profile.proteinGoal;
  return (
    <div className="mp-taste">
      <div className="mp-goal">
        <span className="mp-k">Protein goal</span>
        <div className="mp-step" role="group" aria-label="Protein goal">
          <button type="button" aria-label="Lower the protein goal" disabled={goal <= 40} onClick={() => edit({ op: "goal", protein: goal - 10 })}>
            −
          </button>
          <output>
            {goal}
            <small> g a day</small>
          </output>
          <button type="button" aria-label="Raise the protein goal" disabled={goal >= 400} onClick={() => edit({ op: "goal", protein: goal + 10 })}>
            +
          </button>
        </div>
        <p className="mp-note">
          Each day counts dinner, lunch and the top-up ({f.profile.topUp.text}, {f.profile.topUp.protein} g). A HelloFresh night counts {f.profile.helloFreshProtein} g.
        </p>
      </div>
      <span className="mp-k">Avoid</span>
      <ul className="mp-avoid">
        {f.profile.avoid.map((a) => (
          <li key={a.term}>
            {a.term}
            {a.unless ? <small> unless {a.unless}</small> : null}
            <button type="button" className="hv-x" aria-label={`Allow ${a.term} again`} onClick={() => edit({ op: "unavoid", term: a.term })}>
              ×
            </button>
          </li>
        ))}
        {f.profile.avoid.length ? null : <li className="is-none">Nothing yet.</li>}
      </ul>
      <form
        className="mp-addAvoid"
        onSubmit={(e) => {
          e.preventDefault();
          if (term.trim().length < 2) return;
          edit({
            op: "avoid",
            term: term.trim().toLowerCase(),
            ...(unless.trim() && { unless: unless.trim().toLowerCase() }),
          });
          setTerm("");
          setUnless("");
        }}
      >
        <input value={term} maxLength={40} placeholder="An ingredient, e.g. greek yogurt" aria-label="Ingredient to avoid" onChange={(e) => setTerm(e.target.value)} />
        <input value={unless} maxLength={40} placeholder="unless… (optional)" aria-label="Unless the meal has" onChange={(e) => setUnless(e.target.value)} />
        <button type="submit" className="hv-btn" disabled={term.trim().length < 2}>
          Avoid
        </button>
      </form>
      <p className="mp-note">A new rule swaps every night that breaks it for a backup without it, with Undo.</p>
      {f.profile.likes.length ? (
        <>
          <span className="mp-k">Likes</span>
          <ul className="mp-words">
            {f.profile.likes.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : null}
      {f.profile.rules.length ? (
        <>
          <span className="mp-k">How the week runs</span>
          <ul className="mp-words">
            {f.profile.rules.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** The week's shopping as it stands, recomputed with every change. Confirm week puts it on the Kitchen list. */
export function WeekShopping({ f }: { f: MealsFile }) {
  const lines = useMemo(() => shoppingList(f).map(shopLine), [f]);
  const [open, setOpen] = useState(false);
  return (
    <div className="mp-shop">
      <button type="button" className="mp-shopHead" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>The week's shopping</span>
        <b>{lines.length}</b>
        <i aria-hidden="true">{open ? "−" : "+"}</i>
      </button>
      {open ? (
        <ul aria-label="The week's shopping">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      <p className="mp-note">
        {f.week?.sentAt ? "On the Kitchen list since the week was confirmed; changes since then aren't." : "Goes on the Kitchen list when you confirm the week. Staples stay out."}
      </p>
    </div>
  );
}

function Seed({ onSeeded }: { onSeeded: (f: MealsFile) => void }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="mp-empty">
      <p className="hv-wait">
        <i aria-hidden="true" />
        The meal planner isn't loaded yet.
      </p>
      <p className="mp-note">Its taste profile, catalog and first week are private: they load from a planner file into the Haven's store, never the site.</p>
      <label className="hv-btn">
        Load a planner file
        <input
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file || file.size > 600_000) return setNote(MEALS_NOTE["bad-meals"]!);
            const meals = await file
              .text()
              .then((t) => JSON.parse(t) as unknown)
              .catch(() => null);
            const r = await mealsAction({ action: "seed", meals });
            if (r.ok && r.file) onSeeded(r.file);
            else setNote(MEALS_NOTE[r.error ?? "failed"] ?? MEALS_NOTE.failed!);
          }}
        />
      </label>
      {note ? <p className="mp-note is-warn">{note}</p> : null}
    </div>
  );
}

/**
 * The planner. `onListChanged` rereads the Kitchen list after Confirm week puts the shopping on it; `rail` is the
 * Kitchen list and King Soopers, laid beside the open night.
 */
export function MealPlanner({ onListChanged, rail }: { onListChanged: () => void; rail: ReactNode }) {
  const [load, setLoad] = useState<"idle" | "off" | "failed" | "ready">("idle");
  const [file, setFile] = useState<MealsFile | null>(null);
  const [sel, setSel] = useState<number>(() => (new Date().getDay() + 6) % 7);
  const [over, setOver] = useState<"catalog" | "taste" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The last thing Skippy changed (#698), said over the week until the next change. */
  const [skippy, setSkippy] = useState<string | null>(null);
  const [photos, setPhotos] = useState<ReadonlyMap<string, PhotoState>>(new Map());
  const seq = useRef(0);

  // The nights' own photos: read their states once, then every ten seconds while any is queued or being made.
  const own = useMemo(() => (file?.week?.slots.map((s) => s.photo).filter((p): p is string => !!p) ?? []).join(","), [file]);
  const waiting = own.split(",").some((id) => id && (photos.get(id) ?? "queued") !== "ready" && photos.get(id) !== "failed" && photos.get(id) !== "budget");
  useEffect(() => {
    if (!own) return;
    let alive = true;
    const read = () =>
      void photoStates(own.split(",")).then((m) => {
        if (alive && m) setPhotos((cur) => new Map([...cur, ...m]));
      });
    read();
    const t = waiting ? window.setInterval(read, 10_000) : undefined;
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [own, waiting]);

  useEffect(() => {
    void loadMeals().then((l) => {
      if (l.state === "ready") {
        setFile(l.file);
        setLoad("ready");
      } else if (l.state === "out") useDeskAuth.getState().lost();
      else setLoad(l.state);
    });
  }, []);

  // Skippy changed the plan (#698: the Desk's chat, a Yes tap, a room's mic): read it again the way the page loads, and
  // say what changed. The night he changed opens; an edit of Nikita's still in flight gives way to the newer file.
  useEffect(
    () =>
      onWrote((w) => {
        if (touchesList(w)) onListChanged();
        if (!touchesMeals(w)) return;
        const n = ++seq.current;
        void loadMeals().then((l) => {
          if (n !== seq.current) return;
          setBusy(false);
          if (l.state === "out") return useDeskAuth.getState().lost();
          if (l.state !== "ready") return;
          setFile(l.file);
          setLoad("ready");
          setNote(null);
          const line = w.did.join(" ").trim();
          setSkippy(line ? `Skippy changed it: ${line}` : "Skippy changed the plan.");
          const day = DAYS.findIndex((d) => line.startsWith(DAY_NAME[d]));
          if (day >= 0) setSel(day);
        });
      }),
    [onListChanged],
  );

  const send = useCallback(async (body: MealsAction, shown: MealsFile | null, before: MealsFile | null) => {
    const n = ++seq.current;
    if (shown) setFile(shown);
    setBusy(true);
    setSkippy(null);
    const r = await mealsAction(body);
    if (n !== seq.current) return r;
    setBusy(false);
    if (r.status === 401) useDeskAuth.getState().lost();
    if (r.ok && r.file) setFile(r.file);
    else if (before) setFile(before);
    setNote(r.ok ? r.changes.join(" ") || null : (MEALS_NOTE[r.error ?? "failed"] ?? MEALS_NOTE.failed!));
    return r;
  }, []);

  const edit = useCallback((e: MealEdit) => file && void send({ action: "edit", edit: e }, preview(file, e), file), [file, send]);

  const confirm = async () => {
    const r = await send({ action: "confirm" }, null, null);
    if (!r.ok || !r.file?.week) return;
    onListChanged();
    const list = r.added
      ? `${r.added} thing${r.added === 1 ? "" : "s"} went on the Kitchen list${r.already ? ` (${r.already} already there)` : ""}. Match and send them to King Soopers in the rail.`
      : "The Kitchen list already had everything.";
    // The customized nights go to the photo library (#687); each night keeps the id it answers.
    const queue = r.file.week.photoQueue;
    const shots = queue.map((day) => ({ day, shot: shootOf(r.file!, day) })).filter((x) => x.shot);
    const got = shots.length ? await confirmPhotos(shots.map((x) => x.shot!)) : null;
    let made = "";
    if (shots.length && !got) made = " The photo library didn't answer; the customized nights keep their meal's photo.";
    else if (got) {
      setPhotos((cur) => new Map([...cur, ...got.photos.map((p) => [p.id, p.status] as const)]));
      let f = r.file;
      for (const t of got.photos) {
        const day = shots.find((x) => x.shot!.meal === t.meal)?.day;
        if (!day) continue;
        const e = await mealsAction({
          action: "edit",
          edit: { op: "photo", day, photo: t.id },
        });
        if (e.ok && e.file) f = e.file;
      }
      setFile(f);
      made = got.budget?.reached
        ? " The month's photo cap is reached, so the customized nights keep their meal's photo for now."
        : ` ${got.photos.length} customized meal${got.photos.length === 1 ? "" : "s"} ${got.photos.length === 1 ? "is" : "are"} getting ${got.photos.length === 1 ? "its" : "their"} own photo.`;
    }
    setNote(`Confirmed. ${list}${made}`);
  };

  if (load !== "ready")
    return (
      <>
        {load === "off" ? null : <p className="mp-note">{load === "failed" ? "The meal planner didn't load. It'll try again when you come back." : "Reading the meal planner…"}</p>}
        <div className="mp-railOnly">{rail}</div>
      </>
    );
  if (!file) {
    return (
      <div className="mp-layout">
        <div className="mp-main">
          <Seed onSeeded={setFile} />
        </div>
        <aside className="mp-rail">{rail}</aside>
      </div>
    );
  }
  const w = file.week;
  if (!w) {
    return (
      <div className="mp-layout">
        <div className="mp-main">
          <p className="hv-wait">
            <i aria-hidden="true" />
            No week planned yet.
          </p>
          <button type="button" className="hv-btn is-pri" disabled={busy} onClick={() => edit({ op: "next-week" })}>
            Plan a week from the catalog
          </button>
          {note ? <p className="mp-note">{note}</p> : null}
        </div>
        <aside className="mp-rail">{rail}</aside>
      </div>
    );
  }

  const totals = w.slots.map((s) => dayProtein(file, s).total);
  const avg = Math.round(totals.reduce((a, b) => a + b, 0) / 7);
  const met = totals.filter((t) => t >= file.profile.proteinGoal).length;
  const cooking = w.slots.filter((s) => !s.helloFresh).length;
  const pending = w.slots.filter((s) => !s.helloFresh && !s.photo && slotDish(file, s)?.customized).length;
  const day = DAYS[sel]!;
  const slot = w.slots[sel]!;
  const picks = w.picks.map((id) => mealNamed(file, id)).filter((m): m is Meal => !!m);

  return (
    <PhotoStates.Provider value={photos}>
      <div className="mp">
        <header className="mp-head">
          <div className="mp-title">
            <p className="mp-eyb">
              Week of {weekLabel(w.start)} · <span className={w.confirmedAt ? "is-ok" : "is-draft"}>{w.confirmedAt ? "confirmed" : "draft"}</span>
            </p>
            <div className="mp-stats">
              <span>
                <b className={avg >= file.profile.proteinGoal ? "is-ok" : "is-low"}>{avg}</b> g protein a day <small>goal ≥ {file.profile.proteinGoal}</small>
              </span>
              <span>
                <b>{met}</b>/7 days at goal
              </span>
              <span>
                <b>{cooking}</b> to cook
                {w.slots.length - cooking ? ` · ${w.slots.length - cooking} HelloFresh` : ""}
              </span>
            </div>
          </div>
          <div className="mp-actions">
            <button type="button" className="mp-ghost" onClick={() => setOver("catalog")}>
              Catalog
            </button>
            <button type="button" className="mp-ghost" onClick={() => setOver("taste")}>
              Taste
            </button>
            {file.undo ? (
              <button type="button" className="mp-ghost" disabled={busy} onClick={() => edit({ op: "undo" })} title={`Undo: ${file.undo.label}`}>
                Undo
              </button>
            ) : null}
            {w.confirmedAt ? (
              <button type="button" className="mp-ghost" disabled={busy} onClick={() => edit({ op: "next-week" })}>
                Plan next week
              </button>
            ) : null}
            <button type="button" className={`mp-confirm${w.confirmedAt ? " is-done" : ""}`} disabled={busy || !!w.confirmedAt} onClick={() => void confirm()}>
              <span className="mp-sigil" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {w.confirmedAt ? "Week confirmed" : "Confirm week"}
            </button>
          </div>
        </header>

        <ol className="mp-week" aria-label="This week's dinners">
          {w.slots.map((s, i) => (
            <DayCard key={s.day} f={file} s={s} i={i} open={i === sel} onOpen={() => setSel(i)} />
          ))}
        </ol>

        {note ? (
          <p className="mp-said" role="status">
            {note}
          </p>
        ) : skippy ? (
          <p className="mp-said is-skippy" role="status">
            {skippy}
          </p>
        ) : null}
        {pending && !w.confirmedAt ? (
          <p className="mp-note">
            {pending} customized night{pending === 1 ? "" : "s"}: photo pending until the week is confirmed.
          </p>
        ) : null}

        <div className="mp-layout">
          <div className="mp-main">
            <Drawer f={file} s={slot} edit={edit} key={day} />
            {picks.length ? (
              <section className="mp-new" aria-label="Try something new">
                <span className="mp-k">Try something new?</span>
                <div className="mp-backs">
                  {picks.map((m) => (
                    <button key={m.id} type="button" className="mp-back" onClick={() => edit({ op: "swap", day, meal: m.id })}>
                      <Photo meal={m} className="is-mini" />
                      <span>
                        <b>{m.name}</b>
                        <small>
                          {m.cuisine} · {m.macros.protein} g · put on {SHORT[day]}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
          <aside className="mp-rail">
            <WeekShopping f={file} />
            {rail}
          </aside>
        </div>

        {over === "catalog" ? (
          <Over title="Meal catalog" onClose={() => setOver(null)}>
            <Catalog f={file} day={day} edit={edit} />
          </Over>
        ) : over === "taste" ? (
          <Over title="Taste profile" onClose={() => setOver(null)}>
            <Taste f={file} edit={edit} />
          </Over>
        ) : null}
      </div>
    </PhotoStates.Provider>
  );
}
