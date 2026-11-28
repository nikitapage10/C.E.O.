import { slotText, type Carousel, type DeskAction } from "../data/desk.ts";

type Run = (body: DeskAction, done: string, after?: () => void) => Promise<void>;

const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok" };

/**
 * The carousels between chapters (#1265), at the top of the Feed: each one's slides to swipe through, its caption,
 * where it goes and its slot, and Publish, which schedules the Director's Zernio draft for that slot (a minute out when
 * the slot has passed). Nothing goes out until he taps it. Lays out the same on a phone: the slides scroll sideways.
 */
export function Carousels({ list, run, busy }: { list: Carousel[]; run: Run; busy: boolean }) {
  const open = list.filter((c) => c.status === "ready").sort((a, b) => Date.parse(a.slot ?? "") - Date.parse(b.slot ?? "") || 0);
  if (open.length === 0) return null;
  return (
    <section className="sx-cars" aria-label="Carousels">
      <h4>
        Carousels <small>{open.length}</small>
      </h4>
      {open.map((c) => {
        const line = c.scheduledFor ? `Scheduled for ${slotText(c.scheduledFor)}` : !c.draft ? "Waiting on the Director's draft" : c.slot ? `Slot: ${slotText(c.slot)}` : "No slot set: Publish sends it a minute out";
        return (
          <article key={c.id} className="sx-car">
            <header>
              <b>{c.title}</b>
              <span>
                {c.platforms.map((p) => PLATFORM[p] ?? p).join(" + ")} · {c.slides.length} slides
              </span>
            </header>
            <div className="sx-car-strip" tabIndex={0} aria-label={`${c.title}, ${c.slides.length} slides`}>
              {c.slides.map((s, i) => (
                <img key={s + i} src={s} alt={`Slide ${i + 1}`} loading="lazy" />
              ))}
            </div>
            <p className="sx-car-cap">{c.caption}</p>
            <footer>
              <small role="status">{line}</small>
              <button type="button" className="sx-go" disabled={busy || !c.draft || !!c.scheduledFor} onClick={() => void run({ action: "carousel-publish", id: c.id }, c.slot ? `Scheduled for ${slotText(c.slot)}.` : "It goes out in a minute.")}>
                {c.scheduledFor ? "Scheduled" : "Publish"}
              </button>
            </footer>
          </article>
        );
      })}
    </section>
  );
}
