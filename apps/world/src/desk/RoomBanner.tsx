import { DESK_ROOMS, roomImage, type DeskRoom } from "./deskData.ts";
import { PORTRAITS } from "./portraits.ts";

/**
 * The banner over each Desk page past Today: a wide still of the room the page belongs to, rendered from the Lattice
 * (scripts/desk-images.mjs, 2x for retina), in the room's colour, with the page's title, a line in the room's own
 * voice (its keeper's catchphrase, from the cast) and the page's lead, built from real data by the page. Shorter
 * than Today's hero, so the work stays near the top. Systems, Security and Compliance share the Boiler Room's banner,
 * with the hub's sub-navigation (SystemsNav) right under it.
 */

/** The Desk's pages past Today, and the Systems hub's subpages (all three in the Boiler Room). */
export type BannerPage = "relay" | "foundry" | "systems" | "security" | "compliance" | "chronicle";

export const BANNERS: Record<BannerPage, { room: DeskRoom; eyebrow: string; title: string; voice: { id: string; line: string } }> = {
  relay: { room: "relay", eyebrow: "The switchboard", title: "Relay", voice: { id: "dialtone", line: "Please hold. Not you, darling." } },
  foundry: { room: "foundry", eyebrow: "The coding crew", title: "Foundry", voice: { id: "ember", line: "Weld it. Test it. Ship it. Why are we still talking?" } },
  // The Boiler Room carries the Systems links: Gary keeps the gauges.
  systems: { room: "boiler", eyebrow: "The Boiler Room", title: "Systems", voice: { id: "gary", line: "Honk. (I have tape.)" } },
  // The Pessimist reads the gauges like omens, and is delighted to be wrong: the scans, said its way.
  security: { room: "boiler", eyebrow: "The Boiler Room", title: "Security", voice: { id: "soot", line: "It'll burst. ...Huh. Didn't." } },
  compliance: { room: "boiler", eyebrow: "The Boiler Room", title: "Compliance", voice: { id: "gary", line: "Honk. (I have tape.)" } },
  // The Archive, where the Historian writes the Chronicle up.
  chronicle: { room: "archive", eyebrow: "Ilyr, hour by hour", title: "Chronicle", voice: { id: "vellum", line: "Citation needed. I'll wait." } },
};

/** The room's still, twice the width, for the banner on retina screens. */
export const roomImage2x = (room: DeskRoom) => `/desk/room-${room}@2x.webp`;

export function RoomBanner({ page, lead, aside }: { page: BannerPage; lead?: React.ReactNode; aside?: React.ReactNode }) {
  const { room, eyebrow, title, voice } = BANNERS[page];
  return (
    <header className="banner" style={{ "--tone": DESK_ROOMS[room].accent } as React.CSSProperties}>
      <img
        className="banner__pic"
        src={roomImage(room)}
        srcSet={`${roomImage(room)} 960w, ${roomImage2x(room)} 2880w`}
        sizes="(max-width: 1280px) 100vw, 1280px"
        width={960}
        height={540}
        alt=""
        decoding="async"
      />
      <div className="banner__text">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="desk__title banner__title">{title}</h1>
        <p className="banner__voice">
          <q>{voice.line}</q> <cite>{PORTRAITS[voice.id]?.name ?? voice.id}</cite>
        </p>
        {lead && <p className="banner__lead">{lead}</p>}
      </div>
      {aside && <div className="banner__aside">{aside}</div>}
    </header>
  );
}
