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
  AHEAD_MAX,
  allWeeks,
  candidates,
  loadMeals,
  lunchDish,
  lunchView,
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
  type Course,
  viewOf,
  type Slot,
} from "./meals.ts";
import { confirmPhotos, PHOTO_WORD, photoStates, photoUrl, shootOf, type PhotoState } from "./mealPhotos.ts";
import { onWrote, touchesList, touchesMeals } from "../skippy/wrote.ts";
import { cookLunchOf, cookOf, type Cook } from "./cook.ts";
import { CookMode } from "./CookMode.tsx";
import { onListCleared } from "./groceries.ts";
import "./meals.css";

/**
 * The Kitchen's meal planner (#678), in four steps (#721): Plan (the week as a grid of days, dinner and lunch, #729;
 * the meal picked opens in full under it with its swaps, and Finalize), Customize (the picked dinner's parts, portion
 * and spice), Shop (the week's shopping, the Kitchen list and King Soopers) and Cook (the recipes and cook mode). A
 * week picker holds this week and up to three planned ahead. Every change is one edit of the closed set the server
 * runs (api/_haven/mealShape.ts), shown at once and replaced by the server's answer, aimed at the week shown; Skippy
 * makes the same edits when Nikita talks to him (#698), and the page reads itself again when he does.
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

/** Which meal is open: a day's dinner or its lunch. */
type Pick = { i: number; course: Course } | null;

/**
 * The week as a grid (#729): seven day cards side by side, each with its date and protein ring, dinner as a photo
 * tile and lunch as a shorter one under it. Tap either to open it in full under the grid. Scrolls sideways on a phone.
 */
function DayList({ f, pick, onPick }: { f: MealsFile; pick: Pick; onPick: (p: Pick) => void }) {
  const w = f.week!;
  const today = (new Date().getDay() + 6) % 7;
  const thisWeek = !f.ahead.some((x) => x.start === w.start);
  return (
    <ol className="mp-list" aria-label="This week's meals">
      {w.slots.map((s, i) => {
        const d = slotDish(f, s);
        const p = dayProtein(f, s);
        const l = lunchView(f, s);
        if (!d) return null;
        const on = (c: Course) => pick?.i === i && pick.course === c;
        const from = l.from ? w.slots[DAYS.indexOf(l.from)] : undefined;
        const fromDish = from && !from.helloFresh ? slotDish(f, from) : null;
        const lunchMeal = l.dish?.meal ?? fromDish?.meal ?? null;
        return (
          <li key={s.day} className={`mp-row${s.helloFresh ? " is-hf" : ""}${thisWeek && i === today ? " is-today" : ""}`} style={{ ["--i" as string]: i } as CSSProperties}>
            <div className="mp-rowDay">
              <span className="mp-rowDate">
                <b>{SHORT[s.day]}</b>
                <small>{dateOf(w.start, i).getUTCDate()}</small>
              </span>
              <Ring value={p.total} goal={f.profile.proteinGoal} size={34} />
            </div>
            <button type="button" className="mp-rowMeal is-dinner" aria-pressed={on("dinner")} aria-label={`${DAY_NAME[s.day]}'s dinner: ${s.helloFresh ? "HelloFresh" : d.meal.name}`} onClick={() => onPick(on("dinner") ? null : { i, course: "dinner" })}>
              <Photo meal={d.meal} photo={s.photo} pending={d.customized && !s.photo && !s.helloFresh} className="is-tile" />
              <span>
                <small>
                  Dinner
                  {s.forTwo ? " · for two" : ""}
                  {d.customized && !s.helloFresh ? " · custom" : ""}
                </small>
                <b>{s.helloFresh ? "HelloFresh night" : d.meal.name}</b>
                <em>{s.helloFresh ? `${p.dinner} g protein` : `${d.macros.protein} g · ${d.meal.minutes} min`}</em>
              </span>
            </button>
            <button type="button" className={`mp-rowMeal is-lunch is-${l.kind}`} aria-pressed={on("lunch")} aria-label={`${DAY_NAME[s.day]}'s lunch: ${l.name}`} onClick={() => onPick(on("lunch") ? null : { i, course: "lunch" })}>
              {lunchMeal ? <Photo meal={lunchMeal} photo={l.kind === "leftovers" ? from?.photo : null} className="is-tile" /> : <span className="mp-lunchDot" aria-hidden="true" />}
              <span>
                <small>{l.kind === "leftovers" ? "Lunch · leftovers" : "Lunch"}</small>
                <b>{l.kind === "leftovers" ? (fromDish?.meal.name ?? "Leftovers") : l.name}</b>
                <em>{l.protein} g protein</em>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The open dinner's head: photo, name, blurb, macros and the day's protein. */
function DinnerHead({ f, s, d }: { f: MealsFile; s: Slot; d: Dish }) {
  const p = dayProtein(f, s);
  return (
    <div className="mp-dHead">
      <Photo meal={d.meal} photo={s.photo} pending={d.customized && !s.photo && !s.helloFresh} className="is-big" />
      <div className="mp-dTxt">
        <p className="mp-eyb">
          {DAY_NAME[s.day]} · {d.meal.cuisine} · {d.meal.minutes} min
        </p>
        <h3>{s.helloFresh ? "HelloFresh night" : d.meal.name}</h3>
        <p className="mp-blurb">{s.helloFresh ? `HelloFresh covers ${DAY_NAME[s.day]}: nothing to cook or buy. ${d.meal.name} stays here for a cook-yourself week.` : d.meal.blurb}</p>
        {d.customized ? <p className="mp-changes">{d.changes.join(" · ")}</p> : null}
        <Macros d={d} />
        <div className="mp-dayLine">
          <span>
            Dinner {p.dinner} g{s.helloFresh ? " (HelloFresh)" : ""} · Lunch {p.lunch} g · {f.profile.topUp.text} {p.topUp} g
          </span>
          <b className={p.total >= f.profile.proteinGoal ? "is-ok" : "is-low"}>
            {p.total} / {f.profile.proteinGoal} g
          </b>
        </div>
      </div>
    </div>
  );
}

/** Plan (#721): the open dinner's swaps. Its backups, Not for me, something new, and the night's switches. */
function DinnerPlan({ f, s, edit, onCustomize }: { f: MealsFile; s: Slot; edit: (e: MealEdit) => void; onCustomize: () => void }) {
  const d = slotDish(f, s)!;
  const day = s.day;
  const picks = f.week!.picks.map((id) => mealNamed(f, id)).filter((m): m is Meal => !!m);
  return (
    <section className="mp-drawer" key={`${day}-${d.meal.id}`} aria-label={`${DAY_NAME[day]}'s dinner`}>
      <DinnerHead f={f} s={s} d={d} />
      <div className="mp-toggles">
        <Toggle on={s.helloFresh} label="HelloFresh" onChange={(v) => edit({ op: "night", day, helloFresh: v })} />
        <Toggle on={s.forTwo} label="For two" onChange={(v) => edit({ op: "night", day, forTwo: v })} />
        <Toggle on={s.inCart} label="In the cart" disabled={s.helloFresh} onChange={(v) => edit({ op: "night", day, inCart: v })} />
      </div>
      <div className="mp-swap">
        <span className="mp-k">Swap for</span>
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
      {picks.length ? (
        <div className="mp-swap">
          <span className="mp-k">Something new</span>
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
        </div>
      ) : null}
      {s.helloFresh ? null : (
        <button type="button" className="mp-next" onClick={onCustomize}>
          Customize this meal <span aria-hidden="true">→</span>
          <small>parts, portion, heat</small>
        </button>
      )}
    </section>
  );
}

/** Customize (#721): the open dinner's parts, portion and spice, its recipe and cook mode. */
function DinnerCustom({ f, s, edit }: { f: MealsFile; s: Slot; edit: (e: MealEdit) => void }) {
  const d = slotDish(f, s)!;
  const day = s.day;
  const comps = allComponents(f);
  const portions = portionsOf(f.week!)[DAYS.indexOf(day)]!;
  const [recipe, setRecipe] = useState(false);
  if (s.helloFresh)
    return (
      <section className="mp-drawer" aria-label={`${DAY_NAME[day]}'s dinner`}>
        <DinnerHead f={f} s={s} d={d} />
        <p className="mp-note">A HelloFresh night has nothing to customize here. Turn HelloFresh off in Plan to cook it yourself.</p>
      </section>
    );
  return (
    <section className="mp-drawer" key={`${day}-${d.meal.id}`} aria-label={`Customize ${DAY_NAME[day]}'s dinner`}>
      <DinnerHead f={f} s={s} d={d} />
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
                    <button key={c.id} type="button" className="mp-chip" aria-pressed={part.now?.id === c.id} onClick={() => edit({ op: "customize", day, part: { index: part.index, option: c.id } })}>
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
      <button type="button" className="mp-link" aria-expanded={recipe} onClick={() => setRecipe((v) => !v)}>
        {recipe ? "Hide the recipe" : `Recipe and ingredients (cooked for ${portions})`}
      </button>
      {recipe ? <Recipe steps={d.meal.steps} d={d} /> : null}
    </section>
  );
}

function Recipe({ steps, d }: { steps: string[]; d: Dish }) {
  return (
    <div className="mp-recipe">
      <ol>
        {steps.map((st, i) => (
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
  );
}

/** Cook (#721): the week's recipes once the food's in, each with cook mode. Dinners cooked here and quick lunches. */
function CookList({ f }: { f: MealsFile }) {
  const [cooking, setCooking] = useState<Cook | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const rows = f.week!.slots.flatMap((s) => {
    const out: Array<{ key: string; s: Slot; d: Dish; lunch: boolean }> = [];
    const l = lunchDish(f, s);
    if (l) out.push({ key: `${s.day}-lunch`, s, d: l, lunch: true });
    const d = slotDish(f, s);
    if (d && !s.helloFresh && s.inCart) out.push({ key: `${s.day}-dinner`, s, d, lunch: false });
    return out;
  });
  return (
    <section className="mp-cookList" aria-label="Recipes this week">
      <p className="mp-note">{f.week!.confirmedAt ? "The week's recipes, in order. Cook mode keeps the screen on, one step at a time." : "The week isn't finalized yet; these are the recipes as planned."}</p>
      <ul>
        {rows.map(({ key, s, d, lunch }) => (
          <li key={key} className="mp-cookRow">
            <Photo meal={d.meal} photo={lunch ? null : s.photo} className="is-mini" />
            <span className="mp-cookTxt">
              <small>
                {DAY_NAME[s.day]} · {lunch ? "lunch" : "dinner"} · {d.meal.minutes} min
              </small>
              <b>{d.meal.name}</b>
              {d.customized ? <small>{d.changes.join(" · ")}</small> : null}
            </span>
            <button type="button" className="mp-link" aria-expanded={open === key} onClick={() => setOpen((v) => (v === key ? null : key))}>
              {open === key ? "Hide" : "Recipe"}
            </button>
            <button type="button" className="mp-cook is-small" onClick={() => setCooking(lunch ? cookLunchOf(f, s) : cookOf(f, s))}>
              Cook mode
            </button>
            {open === key ? <Recipe steps={d.meal.steps} d={d} /> : null}
          </li>
        ))}
      </ul>
      {rows.length ? null : <p className="mp-note">Nothing to cook this week: every night is HelloFresh or left out.</p>}
      {cooking ? <CookMode cook={cooking} onClose={() => setCooking(null)} /> : null}
    </section>
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

/**
 * The day's lunch (#719), in full like a dinner (#729): its photo, macros and the day's protein, Leftovers as a switch,
 * its parts, the recipe and cook mode, the backups to swap in, Not for me, and something new to try.
 */
function LunchPanel({ f, s, edit }: { f: MealsFile; s: Slot; edit: (e: MealEdit) => void }) {
  const l = lunchView(f, s);
  const day = s.day;
  const di = DAYS.indexOf(day);
  const p = dayProtein(f, s);
  const [recipe, setRecipe] = useState(false);
  const [cooking, setCooking] = useState(false);
  const cook = cooking ? cookLunchOf(f, s) : null;
  const from = l.from ? f.week!.slots[DAYS.indexOf(l.from)]! : null;
  const fromDish = from && !from.helloFresh ? slotDish(f, from) : null;
  const pool = candidates(f, [s.lunch.meal ?? ""], "lunch");
  // Its backups to swap in (a leftovers day has none of its own: the freshest two stand in), then something new.
  const own = s.lunch.backups.map((id) => pool.find((m) => m.id === id)).filter((m): m is Meal => !!m);
  const backs = own.length ? own : pool.slice(0, 2);
  const fresh = pool.filter((m) => !backs.includes(m)).sort((a, b) => Number(a.timesHad > 0) - Number(b.timesHad > 0)).slice(0, 3);
  const shown = l.dish ?? fromDish;
  const prev = di > 0 ? DAYS[di - 1]! : null;
  const prevSlot = di > 0 ? f.week!.slots[di - 1] : undefined;
  // Leftovers need a night before that's cooked here.
  const canLeft = !!prev && !!prevSlot && !prevSlot.helloFresh;
  const firstOther = backs[0] ?? fresh[0] ?? null;
  const card = (m: Meal, note: string) => (
    <button key={m.id} type="button" className="mp-back" onClick={() => edit({ op: "lunch", day, meal: m.id })}>
      <Photo meal={m} className="is-mini" />
      <span>
        <b>{m.name}</b>
        <small>{note}</small>
      </span>
    </button>
  );
  return (
    <section className="mp-drawer mp-lunch" aria-label={`${DAY_NAME[day]}'s lunch`}>
      <div className="mp-dHead">
        {shown ? <Photo meal={shown.meal} photo={l.kind === "leftovers" ? from?.photo : null} className="is-big" /> : <span className="mp-photo is-big mp-lunchDot" aria-hidden="true" />}
        <div className="mp-dTxt">
          <p className="mp-eyb">
            {DAY_NAME[day]} · lunch{shown ? ` · ${shown.meal.cuisine}` : ""}
            {l.kind === "quick" ? ` · ${l.dish!.meal.minutes} min` : ""}
          </p>
          <h3>{l.name}</h3>
          <p className="mp-blurb">
            {l.kind === "leftovers"
              ? `${DAY_NAME[l.from!]}'s dinner, cooked one portion bigger so there's lunch. Nothing extra to buy.`
              : l.kind === "quick"
                ? l.dish!.meal.blurb
                : "A lunch of its own words; pick a quick lunch below to plan it properly."}
          </p>
          {shown ? <Macros d={l.kind === "leftovers" ? { ...shown, macros: { ...shown.macros, protein: l.protein } } : shown} /> : null}
          <div className="mp-dayLine">
            <span>
              Dinner {p.dinner} g · Lunch {p.lunch} g · {f.profile.topUp.text} {p.topUp} g
            </span>
            <b className={p.total >= f.profile.proteinGoal ? "is-ok" : "is-low"}>
              {p.total} / {f.profile.proteinGoal} g
            </b>
          </div>
        </div>
      </div>
      <div className="mp-toggles">
        <Toggle
          on={l.kind === "leftovers"}
          label={prev ? `Leftovers from ${DAY_NAME[prev]}` : "Leftovers"}
          disabled={l.kind === "leftovers" ? !firstOther : !canLeft}
          onChange={(v) => (v ? edit({ op: "lunch", day, leftovers: true }) : firstOther && edit({ op: "lunch", day, meal: firstOther.id }))}
        />
      </div>
      {shown && shown.parts.some((x) => x.now) ? (
        <div className="mp-swap">
          <span className="mp-k">Parts</span>
          <div className="mp-chips is-static">
            {shown.parts.map((x) =>
              x.now ? (
                <span key={x.index} className="mp-chip">
                  {x.now.name}
                  <small>{ROLE_NAME[x.role].toLowerCase()}</small>
                </span>
              ) : null,
            )}
          </div>
        </div>
      ) : null}
      {l.kind === "quick" ? (
        <div className="mp-lunchActs">
          <button type="button" className="mp-link" aria-expanded={recipe} onClick={() => setRecipe((v) => !v)}>
            {recipe ? "Hide the recipe" : "Recipe and ingredients"}
          </button>
          <button type="button" className="mp-cook is-small" onClick={() => setCooking(true)}>
            Cook lunch
          </button>
        </div>
      ) : null}
      {recipe && l.dish ? <Recipe steps={l.dish.meal.steps} d={l.dish} /> : null}
      {cook ? <CookMode cook={cook} onClose={() => setCooking(false)} /> : null}
      <div className="mp-swap">
        <span className="mp-k">Swap for</span>
        <div className="mp-backs" role="group" aria-label={`Other lunches for ${DAY_NAME[day]}`}>
          {canLeft && l.kind !== "leftovers" ? (
            <button type="button" className="mp-back is-left" onClick={() => edit({ op: "lunch", day, leftovers: true })}>
              <span>
                <b>Leftovers</b>
                <small>{DAY_NAME[prev!]}'s dinner, one portion more</small>
              </span>
            </button>
          ) : null}
          {backs.map((m) => card(m, `${m.minutes} min · ${m.macros.protein} g protein`))}
          {l.kind === "quick" ? (
            <button type="button" className="mp-nope" onClick={() => edit({ op: "pass", meal: l.dish!.meal.id, passed: true })}>
              Not for me
            </button>
          ) : null}
        </div>
      </div>
      {fresh.length ? (
        <div className="mp-swap">
          <span className="mp-k">Something new</span>
          <div className="mp-backs">{fresh.map((m) => card(m, `${m.cuisine} · ${m.macros.protein} g · ${m.timesHad ? "had before" : "never had"}`))}</div>
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
  const [course, setCourse] = useState<Course>("dinner");
  const of = f.catalog.filter((m) => m.course === course);
  const rows = of.map((m) => ({ m, st: statusOf(f, m) })).sort((a, b) => ORDER.indexOf(a.st) - ORDER.indexOf(b.st) || a.m.name.localeCompare(b.m.name));
  const lunches = f.catalog.filter((m) => m.course === "lunch").length;
  return (
    <div className="mp-cat">
      <div className="mp-chips" role="group" aria-label="Dinners or lunches">
        <button type="button" className="mp-chip" aria-pressed={course === "dinner"} onClick={() => setCourse("dinner")}>
          Dinners <small>{f.catalog.length - lunches}</small>
        </button>
        <button type="button" className="mp-chip" aria-pressed={course === "lunch"} onClick={() => setCourse("lunch")}>
          Lunches <small>{lunches}</small>
        </button>
      </div>
      <p className="mp-note">
        {of.length} {course === "lunch" ? "quick lunches" : "dinners"}. Macros are estimates for one portion. "Put on" swaps it in for {DAY_NAME[day]}
        {course === "lunch" ? "'s lunch" : ""}.
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
                {st !== "passed" && st !== "avoid" && (st !== "week" || (m.course === "lunch" && f.week?.slots[DAYS.indexOf(day)]?.lunch.meal !== m.id)) ? (
                  <button type="button" className="mp-link" onClick={() => edit(m.course === "lunch" ? { op: "lunch", day, meal: m.id } : { op: "swap", day, meal: m.id })}>
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
          Each day counts dinner, lunch (leftovers count as one more portion of that dinner) and the top-up ({f.profile.topUp.text}, {f.profile.topUp.protein} g). A HelloFresh night counts {f.profile.helloFreshProtein} g.
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
export function WeekShopping({ f, open: start = false }: { f: MealsFile; open?: boolean }) {
  const lines = useMemo(() => shoppingList(f).map(shopLine), [f]);
  const [open, setOpen] = useState(start);
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
        {f.week?.sentAt ? "On the Kitchen list since the week was finalized; changes since then aren't." : "Goes on the Kitchen list when you finalize the week. Staples stay out."}
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

const PHASES = [
  { id: "plan", name: "Plan", hint: "Set the meals" },
  { id: "customize", name: "Customize", hint: "Switch them up" },
  { id: "shop", name: "Shop", hint: "Cart and send" },
  { id: "cook", name: "Cook", hint: "Recipes" },
] as const;
type Phase = (typeof PHASES)[number]["id"];

/**
 * The planner (#678; the phases and weeks ahead, #721). `onListChanged` rereads the Kitchen list after Finalize puts
 * the shopping on it; `rail` is the Kitchen list and King Soopers, shown in the Shop step.
 */
export function MealPlanner({ onListChanged, rail }: { onListChanged: () => void; rail: ReactNode }) {
  const [load, setLoad] = useState<"idle" | "off" | "failed" | "ready">("idle");
  const [file, setFile] = useState<MealsFile | null>(null);
  /** The week shown: null for the current one, else a week ahead by its Monday. */
  const [start, setStart] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [pick, setPick] = useState<Pick>(null);
  const [over, setOver] = useState<"catalog" | "taste" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The last thing Skippy changed (#698), said over the week until the next change. */
  const [skippy, setSkippy] = useState<string | null>(null);
  const [photos, setPhotos] = useState<ReadonlyMap<string, PhotoState>>(new Map());
  const seq = useRef(0);
  const detail = useRef<HTMLDivElement>(null);

  // The open meal sits under the week's grid (#729): bring it into view when one is picked and it's out of sight.
  useEffect(() => {
    const el = detail.current;
    if (!pick || !el) return;
    const b = el.getBoundingClientRect();
    if (b.top > window.innerHeight - 160 || b.top < 0) el.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, [pick]);

  // The nights' own photos, every planned week: read their states once, then every ten seconds while any is being made.
  const own = useMemo(
    () =>
      (file ? allWeeks(file) : [])
        .flatMap((w) => w.slots.map((s) => s.photo))
        .filter((p): p is string => !!p)
        .join(","),
    [file],
  );
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
  // say what changed. The day he changed opens on this week; an edit of Nikita's still in flight gives way to the newer file.
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
          if (day >= 0) {
            setStart(null);
            setPick({ i: day, course: /^\w+'s lunch/.test(line) ? "lunch" : "dinner" });
          }
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

  // A week that's gone (moved on, or Undo took it back) falls back to the current one.
  const at = file && start && file.ahead.some((w) => w.start === start) ? start : null;

  // The Shopping card's Clear list (#761): the list is empty, so the week shown opens again (Finalize too) at Plan.
  const atRef = useRef<string | null>(null);
  useEffect(() => {
    atRef.current = at;
  }, [at]);
  useEffect(
    () =>
      onListCleared(() => {
        setPhase("plan");
        setPick(null);
        onListChanged();
        const n = ++seq.current;
        void mealsAction({ action: "reopen", ...(atRef.current && { week: atRef.current }) }).then((r) => {
          if (n !== seq.current) return;
          if (r.status === 401) return useDeskAuth.getState().lost();
          if (r.ok && r.file) setFile(r.file);
        });
      }),
    [onListChanged],
  );
  const aim = useCallback((e: MealEdit): MealEdit => (at && e.op !== "undo" && e.op !== "next-week" && e.op !== "plan-ahead" ? { ...e, week: at } : e), [at]);
  const edit = useCallback(
    (e: MealEdit) => {
      if (!file) return;
      const x = aim(e);
      void send({ action: "edit", edit: x }, preview(file, x), file);
    },
    [file, send, aim],
  );

  const confirm = async () => {
    const r = await send({ action: "confirm", ...(at && { week: at }) }, null, null);
    if (!r.ok || !r.file?.week) return;
    onListChanged();
    const list = r.added
      ? `${r.added} thing${r.added === 1 ? "" : "s"} went on the Kitchen list${r.already ? ` (${r.already} already there)` : ""}. Match and send them to King Soopers here.`
      : "The Kitchen list already had everything.";
    // The customized nights go to the photo library (#687); each night keeps the id it answers.
    const v = viewOf(r.file, at);
    const queue = v.week!.photoQueue;
    const shots = queue.map((day) => ({ day, shot: shootOf(v, day) })).filter((x) => x.shot);
    const got = shots.length ? await confirmPhotos(shots.map((x) => x.shot!)) : null;
    let made = "";
    if (shots.length && !got) made = " The photo library didn't answer; the customized nights keep their meal's photo.";
    else if (got) {
      setPhotos((cur) => new Map([...cur, ...got.photos.map((p) => [p.id, p.status] as const)]));
      let f = r.file;
      for (const t of got.photos) {
        const day = shots.find((x) => x.shot!.meal === t.meal)?.day;
        if (!day) continue;
        const e = await mealsAction({ action: "edit", edit: { op: "photo", day, photo: t.id, ...(at && { week: at }) } });
        if (e.ok && e.file) f = e.file;
      }
      setFile(f);
      made = got.budget?.reached
        ? " The month's photo cap is reached, so the customized nights keep their meal's photo for now."
        : ` ${got.photos.length} customized meal${got.photos.length === 1 ? "" : "s"} ${got.photos.length === 1 ? "is" : "are"} getting ${got.photos.length === 1 ? "its" : "their"} own photo.`;
    }
    setNote(`Finalized. ${list}${made}`);
    setPhase("shop");
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
  if (!file.week) {
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

  const view = viewOf(file, at);
  const w = view.week!;
  // The step to open on: Plan while the week's a draft, Shop once it's finalized.
  const step: Phase = phase ?? (w.confirmedAt ? "shop" : "plan");
  const totals = w.slots.map((s) => dayProtein(view, s).total);
  const avg = Math.round(totals.reduce((a, b) => a + b, 0) / 7);
  const met = totals.filter((t) => t >= view.profile.proteinGoal).length;
  const cooking = w.slots.filter((s) => !s.helloFresh).length;
  const quick = w.slots.filter((s) => s.lunch.meal).length;
  const pending = w.slots.filter((s) => !s.helloFresh && !s.photo && slotDish(view, s)?.customized).length;
  const slot = pick ? w.slots[pick.i] : undefined;
  const weeks = allWeeks(file);
  const finalize = (
    <button type="button" className={`mp-confirm${w.confirmedAt ? " is-done" : ""}`} disabled={busy || !!w.confirmedAt} onClick={() => void confirm()}>
      <span className="mp-sigil" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {w.confirmedAt ? "Week finalized" : "Finalize the week"}
    </button>
  );

  return (
    <PhotoStates.Provider value={photos}>
      <div className="mp">
        <nav className="mp-weeks" aria-label="Weeks">
          {weeks.map((x, k) => (
            <button
              key={x.start}
              type="button"
              className="mp-weekBtn"
              aria-pressed={x.start === w.start}
              onClick={() => {
                setStart(k === 0 ? null : x.start);
                setPick(null);
                setPhase(null);
              }}
            >
              <small>{k === 0 ? "This week" : k === 1 ? "Next week" : `In ${k} weeks`}</small>
              <b>{weekLabel(x.start)}</b>
              <i className={x.confirmedAt ? "is-ok" : "is-draft"}>{x.confirmedAt ? "finalized" : "draft"}</i>
            </button>
          ))}
          {file.ahead.length < AHEAD_MAX ? (
            <button type="button" className="mp-weekBtn is-add" disabled={busy} onClick={() => edit({ op: "plan-ahead" })}>
              <small>Plan ahead</small>
              <b>+ a week</b>
              <i>up to a month</i>
            </button>
          ) : null}
        </nav>

        <header className="mp-head">
          <div className="mp-title">
            <p className="mp-eyb">
              Week of {weekLabel(w.start)} · <span className={w.confirmedAt ? "is-ok" : "is-draft"}>{w.confirmedAt ? "finalized" : "draft"}</span>
            </p>
            <div className="mp-stats">
              <span>
                <b className={avg >= view.profile.proteinGoal ? "is-ok" : "is-low"}>{avg}</b> g protein a day <small>goal ≥ {view.profile.proteinGoal}</small>
              </span>
              <span>
                <b>{met}</b>/7 days at goal
              </span>
              <span>
                <b>{cooking}</b> dinners to cook
                {w.slots.length - cooking ? ` · ${w.slots.length - cooking} HelloFresh` : ""}
                {quick ? ` · ${quick} quick lunch${quick === 1 ? "" : "es"}` : ""}
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
            {!at && w.confirmedAt ? (
              <button type="button" className="mp-ghost" disabled={busy} onClick={() => edit({ op: "next-week" })}>
                {file.ahead.length ? "On to next week" : "Plan next week"}
              </button>
            ) : null}
            {finalize}
          </div>
        </header>

        <ol className="mp-steps" aria-label="Steps">
          {PHASES.map((p, k) => (
            <li key={p.id}>
              <button type="button" aria-current={step === p.id ? "step" : undefined} className={PHASES.findIndex((x) => x.id === step) > k ? "is-past" : ""} onClick={() => setPhase(p.id)}>
                <i>{k + 1}</i>
                <span>
                  <b>{p.name}</b>
                  <small>{p.hint}</small>
                </span>
              </button>
            </li>
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

        {step === "plan" || step === "customize" ? (
          <div className="mp-plan">
            <DayList f={view} pick={pick} onPick={setPick} />
            <div className="mp-detail" ref={detail}>
              {!slot ? (
                step === "plan" ? (
                  <section className="mp-drawer mp-overview" aria-label="Finalize the week">
                    <h3>Set the week's meals</h3>
                    <p className="mp-note">Pick a dinner or a lunch above to swap it, pass on it, or try something new. When the week looks right, Finalize the week: its shopping goes on the Kitchen list for King Soopers.</p>
                    {pending && !w.confirmedAt ? (
                      <p className="mp-note">
                        {pending} customized night{pending === 1 ? "" : "s"}: photo pending until the week is finalized.
                      </p>
                    ) : null}
                    <div className="mp-overActs">
                      <button type="button" className="mp-ghost" onClick={() => setPhase("customize")}>
                        Customize first
                      </button>
                      <button type="button" className="mp-ghost" onClick={() => setPhase("shop")}>
                        See the shopping
                      </button>
                    </div>
                  </section>
                ) : (
                  <section className="mp-drawer mp-overview" aria-label="Customize">
                    <h3>Switch it up</h3>
                    <p className="mp-note">Pick a dinner above to change its protein, carb or side, the portion and the heat. Protein and the shopping follow at once.</p>
                  </section>
                )
              ) : pick!.course === "lunch" ? (
                <LunchPanel f={view} s={slot} edit={edit} key={`${w.start}-${slot.day}`} />
              ) : step === "plan" ? (
                <DinnerPlan f={view} s={slot} edit={edit} onCustomize={() => setPhase("customize")} key={`${w.start}-${slot.day}`} />
              ) : (
                <DinnerCustom f={view} s={slot} edit={edit} key={`${w.start}-${slot.day}`} />
              )}
            </div>
          </div>
        ) : step === "shop" ? (
          w.confirmedAt ? (
            // Finalized, the week's shopping is on the Kitchen list: the one Shopping card says it, not a second copy (#737).
            <div className="mp-shopStep is-solo">
              <div className="mp-railIn">{rail}</div>
            </div>
          ) : (
            <div className="mp-shopStep">
              <div className="mp-main">
                <WeekShopping f={view} open />
                <section className="mp-drawer mp-overview" aria-label="Finalize the week">
                  <p className="mp-note">Finalize the week (above) to put its shopping on the Kitchen list, then Finalize &amp; match there: every item matched at King Soopers, ready to check and send to the cart.</p>
                </section>
              </div>
              <div className="mp-railIn">{rail}</div>
            </div>
          )
        ) : (
          <CookList f={view} />
        )}

        {over === "catalog" ? (
          <Over title="Meal catalog" onClose={() => setOver(null)}>
            <Catalog f={view} day={DAYS[pick?.i ?? (new Date().getDay() + 6) % 7]!} edit={edit} />
          </Over>
        ) : over === "taste" ? (
          <Over title="Taste profile" onClose={() => setOver(null)}>
            <Taste f={view} edit={edit} />
          </Over>
        ) : null}
      </div>
    </PhotoStates.Provider>
  );
}
