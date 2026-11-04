/**
 * The vacuum's room names (#632): the Qrevo's map numbers its rooms by segment, and `get_room_mapping` pairs each
 * segment with the Roborock app's room id; the app's home data names those ids ("Kitchen", "Hall"). This matches what
 * Nikita says or taps ("the kitchen", "hallway and dining") to segments, forgivingly but never by guessing between
 * two rooms.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export interface MapRoom {
  segment: number;
  name: string;
}

/** The segment-to-room-id pairs from `get_room_mapping`: a list of [segment, id, …] or a single flat pair. */
export function segmentPairs(result: unknown): Array<[number, string]> {
  if (!Array.isArray(result)) return [];
  if (result.length >= 2 && !Array.isArray(result[0])) {
    const seg = Number(result[0]);
    return Number.isInteger(seg) ? [[seg, String(result[1])]] : [];
  }
  const out: Array<[number, string]> = [];
  for (const part of result) {
    if (!Array.isArray(part) || part.length < 2) continue;
    const seg = Number(part[0]);
    if (Number.isInteger(seg)) out.push([seg, String(part[1])]);
  }
  return out;
}

/** The map's rooms with the app's names; a segment with no name is "Room <segment>". */
export function namedRooms(pairs: Array<[number, string]>, names: Record<string, string>): MapRoom[] {
  return pairs.map(([segment, id]) => ({ segment, name: (names[id] ?? "").trim() || `Room ${segment}` }));
}

const ALIASES: Record<string, string> = {
  hallway: "hall",
  entry: "hall",
  entryway: "hall",
  foyer: "hall",
  lounge: "living",
  "living room": "living",
  "family room": "living",
  "dining room": "dining",
  "dining area": "dining",
  "kitchen area": "kitchen",
  office: "studio",
  study: "studio",
  passage: "corridor",
  "master bedroom": "bedroom",
  "main bedroom": "bedroom",
  bath: "bathroom",
  washroom: "bathroom",
};

/** A room name boiled down: lower case, no "the", "room" or punctuation, aliases folded. */
export function roomKey(name: string): string {
  let s = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\b(?:the|my|our|please|too|also)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (ALIASES[s]) return ALIASES[s]!;
  s = s.replace(/\broom$/, "").trim();
  if (ALIASES[s]) return ALIASES[s]!;
  return s.replace(/s$/, "");
}

/** Room names from words like "the kitchen and the hall", "kitchen, dining". */
export function splitRooms(words: string): string[] {
  return words
    .split(/\s*(?:,|&|\band\b|\bplus\b|\bthen\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export interface RoomMatch {
  rooms: MapRoom[];
  unknown: string[];
}

/** Matches each asked name to exactly one room: the same key, or one key starting with the other when only one does. */
export function matchRooms(asked: string[], rooms: MapRoom[]): RoomMatch {
  const found: MapRoom[] = [];
  const unknown: string[] = [];
  const keyed = rooms.map((r) => ({ r, k: roomKey(r.name) }));
  for (const a of asked.flatMap(splitRooms)) {
    const k = roomKey(a);
    if (!k) continue;
    let hits = keyed.filter((x) => x.k === k);
    if (!hits.length) hits = keyed.filter((x) => x.k.startsWith(k) || k.startsWith(x.k));
    if (hits.length === 1) {
      if (!found.includes(hits[0]!.r)) found.push(hits[0]!.r);
    } else unknown.push(a.trim().slice(0, 40));
  }
  return { rooms: found, unknown };
}
