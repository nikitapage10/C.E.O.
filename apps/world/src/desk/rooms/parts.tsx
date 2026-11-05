import { KeeperLine } from "@ceo/engine/web/RoomParts.tsx";
import { BANNERS, type BannerPage } from "../RoomBanner.tsx";
import { PORTRAITS } from "../portraits.ts";

/**
 * Pieces the room pages share (#225). They live in the engine now (`@ceo/engine/web/RoomParts.tsx`, #617 step 5, with
 * their shared rules in `roomParts.css`); this keeps the old path and reads the keeper's line from the room's banner,
 * so the engine itself reaches no lore. Each room dresses them in its own look.
 */
export { Waits, type Wait } from "@ceo/engine/web/RoomParts.tsx";

/** The room's keeper, in their own words (the cast's catchphrase, as on the room's banner). */
export function Keeper({ page, className = "" }: { page: BannerPage; className?: string }) {
  const { voice } = BANNERS[page];
  return <KeeperLine id={voice.id} name={PORTRAITS[voice.id]?.name ?? voice.id} line={voice.line} className={className} />;
}
