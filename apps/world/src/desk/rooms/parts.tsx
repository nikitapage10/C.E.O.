import { BANNERS, type BannerPage } from "../RoomBanner.tsx";
import { PORTRAITS } from "../portraits.ts";

/**
 * Pieces the room pages share (#225). Each room dresses them in its own look (rooms/*.css): the keeper's line, and the
 * honest list of what the room waits on before it shows anything real. No room page shows a number it doesn't have.
 */

export interface Wait {
  /** What has to be connected or set. */
  what: string;
  /** Why, and where it lives (keys stay on the server or the hub, never in the repository). */
  why: string;
  /** "needed" until it's done; "asked" when it has been requested and is on its way. */
  state?: "needed" | "asked" | "later";
}

/** The room's keeper, in their own words (the cast's catchphrase, as on the room's banner). */
export function Keeper({ page, className = "" }: { page: BannerPage; className?: string }) {
  const { voice } = BANNERS[page];
  return (
    <figure className={`rm-keeper ${className}`}>
      <img src={`/desk/agent-${voice.id}.webp`} alt="" width={56} height={56} decoding="async" />
      <blockquote>{voice.line}</blockquote>
      <figcaption>{PORTRAITS[voice.id]?.name ?? voice.id}</figcaption>
    </figure>
  );
}

const STATE_WORD: Record<NonNullable<Wait["state"]>, string> = { needed: "Waiting", asked: "Requested", later: "Later" };

/** What the room waits on, in order. */
export function Waits({ items, title = "What it waits on", className = "" }: { items: Wait[]; title?: string; className?: string }) {
  return (
    <section className={`rm-waits ${className}`} aria-label={title}>
      <h2 className="rm-h2">{title}</h2>
      <ol>
        {items.map((w) => (
          <li key={w.what} data-state={w.state ?? "needed"}>
            <b>{w.what}</b>
            <span>{w.why}</span>
            <em>{STATE_WORD[w.state ?? "needed"]}</em>
          </li>
        ))}
      </ol>
    </section>
  );
}
