/**
 * Which of the vacuum's own room names each plan room is (#894). The plan and the vacuum name rooms their own way
 * ("Master bath" and "Master Bathroom", "Dining" and "Dining room", "Closet" and "Master Closet"), so the names are
 * matched in tiers: the room's explicit vacuum name first, then the same words without case, then the same words once
 * synonyms are folded (bath/bathroom, hallway/hall) and filler dropped ("room"), then one name's words inside the
 * other's. Every tier after the first takes a pair only when it is the one candidate on both sides, so two bedrooms
 * never both claim "Bedroom". Pure, so it is tested on its own with made-up names.
 */

type Room = { id: string; name: string; vacuum: string | null };

const SYNONYMS: Record<string, string> = {
  bathroom: "bath",
  bathrm: "bath",
  ba: "bath",
  restroom: "bath",
  washroom: "bath",
  toilet: "wc",
  powder: "wc",
  bedroom: "bed",
  bedrm: "bed",
  br: "bed",
  primary: "master",
  main: "master",
  mstr: "master",
  hallway: "hall",
  wardrobe: "closet",
  wic: "closet",
  kitchenette: "kitchen",
  lounge: "living",
  livingroom: "living",
  diningroom: "dining",
  laundryroom: "laundry",
  utility: "laundry",
  office: "study",
  den: "study",
};

/** Words that say nothing about which room it is. */
const FILLER = new Set(["room", "rm", "area", "the", "and", "of", "s"]);

/** A name as the words that tell it apart: lower case, no punctuation, synonyms folded, filler dropped. */
export function roomWords(name: string): string[] {
  const words = name
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => SYNONYMS[w] ?? w)
    .filter((w) => !FILLER.has(w));
  return [...new Set(words)];
}

const same = (a: string[], b: string[]) => a.length > 0 && a.length === b.length && a.every((w) => b.includes(w));
const inside = (a: string[], b: string[]) => a.length > 0 && b.length > 0 && (a.every((w) => b.includes(w)) || b.every((w) => a.includes(w)));

/** Plan room id → the vacuum's name for it, for every plan room that has one. */
export function matchVacuumRooms(names: string[], rooms: Room[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const take = (r: Room, n: string) => {
    out.set(r.id, n);
    used.add(n);
  };
  const open = () => rooms.filter((r) => !out.has(r.id));
  const free = () => names.filter((n) => !used.has(n));

  // An explicit vacuum name on the plan room is kept as written: exact (without case), else the same words.
  for (const r of rooms) {
    if (!r.vacuum) continue;
    const want = r.vacuum.toLowerCase();
    const n = free().find((x) => x.toLowerCase() === want) ?? free().find((x) => same(roomWords(x), roomWords(r.vacuum!)));
    if (n) take(r, n);
  }
  // Rooms with an explicit vacuum name that didn't match aren't guessed at.
  const guessable = () => open().filter((r) => !r.vacuum);

  const tiers: ((r: Room, n: string) => boolean)[] = [
    (r, n) => r.name.toLowerCase() === n.toLowerCase(),
    (r, n) => same(roomWords(r.name), roomWords(n)),
    (r, n) => inside(roomWords(r.name), roomWords(n)),
  ];
  for (const fits of tiers) {
    // Unique on both sides, repeated while it still settles pairs (a match can leave another pair unique).
    for (let settled = true; settled; ) {
      settled = false;
      const rs = guessable(),
        ns = free();
      for (const r of rs) {
        const mine = ns.filter((n) => !used.has(n) && fits(r, n));
        if (mine.length !== 1) continue;
        const n = mine[0]!;
        const rivals = rs.filter((o) => !out.has(o.id) && fits(o, n));
        if (rivals.length !== 1) continue;
        take(r, n);
        settled = true;
      }
    }
  }
  return out;
}
