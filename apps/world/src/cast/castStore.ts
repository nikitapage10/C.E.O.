import { LINEAGE_LOOK, LINEAGES, parseCast, type Cast, type Look, type Profile, type Relationship } from "@ceo/core";
import { defaultCast } from "@ceo/simulator";
import { create } from "zustand";

/**
 * The cast as you've customised it: names, looks, personalities, relationships. Saved in this browser
 * (localStorage) for now; in phase 2 the hub keeps it so it follows you between devices.
 */
const KEY = "ceo.cast.v2";
/** Bumped when the default looks are re-cast: saved casts take the new looks once, keeping names and personalities. */
const LOOKS_KEY = "ceo.cast.looks";
const LOOKS_REV = 9;
/** Default names that were changed: a saved cast still using any of the old ones takes the new one. */
const RENAMED: Record<string, [string[], string]> = {
  caret: [["Caret"], "Rocky"],
  odds: [["Odds"], "Noco"],
  postmaster: [["Postmaster"], "Blasto"],
  // Semicolon became Rivet, who handed the bench to Tallboy, then Skippy; Skippy took the Kernel and Rivet came back (an early cut of the change called the bench Ember).
  semicolon: [["Semicolon", "Tallboy", "Skippy", "Ember"], "Rivet"],
  tessellate: [["Tessellate"], "Rusty"],
  // The Skippy subminds went from code names to titles (the ids stay, so saved state still lines up).
  ember: [["Ember"], "The Builder"],
  gilt: [["Gilt"], "The Executive"],
  ticker: [["Ticker"], "The Bookie"],
  turf: [["Turf"], "The Commentator"],
  static: [["Static"], "The Messenger"],
  vellum: [["Vellum"], "The Historian"],
  fizz: [["Fizz"], "The Life of the Party"],
  soot: [["Soot"], "The Pessimist"],
  putty: [["Putty"], "The Artiste"],
};

/** Give every profile still wearing an old default name its new one. */
function rename(profiles: Record<string, Profile>) {
  for (const [id, [was, now]] of Object.entries(RENAMED)) {
    const p = profiles[id];
    if (p && was.includes(p.name)) profiles[id] = { ...p, name: now };
  }
}
/**
 * Bumped when the default characters are rewritten: saved casts take the new roles, personalities, dossiers and
 * relationships once, keeping their looks (and any name you chose yourself).
 */
const LORE_KEY = "ceo.cast.lore";
const LORE_REV = 10;

function readRev(key: string) {
  try {
    return Number(localStorage.getItem(key) ?? 0);
  } catch {
    return 0; // Unreadable: treat as old.
  }
}

function load(): Cast {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? parseCast(JSON.parse(raw)) : null;
    if (parsed) {
      // New sample agents get their defaults; customised ones keep yours.
      const base = defaultCast();
      const profiles = { ...base.profiles, ...parsed.profiles };
      // Casts saved before dossiers existed pick up the default lore.
      for (const [id, p] of Object.entries(parsed.profiles)) {
        const seed = base.profiles[id]?.lore;
        if (seed && !p.lore.title && !p.lore.origin && !p.lore.chronicle.length) profiles[id] = { ...p, lore: seed };
      }
      // ...and the default relationships of agents that are new since the cast was saved.
      const added = base.relationships.filter((r) => !(r.a in parsed.profiles) || !(r.b in parsed.profiles));
      let relationships = [...parsed.relationships, ...added];
      let migrated = added.length > 0;
      if (readRev(LORE_KEY) < LORE_REV) {
        migrated = true;
        for (const [id, p] of Object.entries(base.profiles)) {
          if (profiles[id]) profiles[id] = { ...profiles[id], role: p.role, personality: p.personality, lore: p.lore };
        }
        rename(profiles);
        relationships = base.relationships;
      }
      if (readRev(LOOKS_KEY) < LOOKS_REV) {
        migrated = true;
        for (const [id, p] of Object.entries(base.profiles)) if (profiles[id]) profiles[id] = { ...profiles[id], look: p.look };
        rename(profiles);
      }
      const cast = { ...parsed, profiles, relationships };
      // Keep the migrated cast, so the rewrite isn't undone on the next visit. (Private mode: it reruns, harmlessly.)
      if (migrated) save(cast);
      return cast;
    }
  } catch {
    /* Storage unavailable or corrupt: start fresh. */
  }
  return defaultCast();
}

function save(cast: Cast) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cast));
    // A cast saved now already has the current looks.
    localStorage.setItem(LOOKS_KEY, String(LOOKS_REV));
    localStorage.setItem(LORE_KEY, String(LORE_REV));
  } catch {
    /* Private mode etc.: edits last for this session only. */
  }
}

interface CastStore {
  cast: Cast;
  /** The agent open in the Agent Studio. */
  studio: string | null;
  openStudio: (id: string | null) => void;
  updateProfile: (
    id: string,
    patch: Partial<Omit<Profile, "look" | "personality" | "lore">> & { personality?: Partial<Profile["personality"]>; lore?: Partial<Profile["lore"]> },
  ) => void;
  setLook: (id: string, look: Partial<Look>) => void;
  addRelationship: (r: Relationship) => void;
  updateRelationship: (index: number, patch: Partial<Relationship>) => void;
  removeRelationship: (index: number) => void;
  resetAgent: (id: string) => void;
  resetAll: () => void;
  /**
   * Take on how the living world has moved relationships on while nobody was looking (the hourly step, docs/WORLD.md):
   * each pair the world changed takes its new kind and note. Pairs it never touched keep whatever you set.
   */
  adoptWorld: (changed: Relationship[]) => void;
  importCast: (json: string) => boolean;
}

export const useCast = create<CastStore>((set, get) => {
  const commit = (cast: Cast) => {
    save(cast);
    set({ cast });
  };
  return {
    cast: load(),
    studio: null,
    openStudio: (studio) => set({ studio }),
    updateProfile: (id, patch) => {
      const { cast } = get();
      const p = cast.profiles[id];
      if (!p) return;
      const next: Profile = {
        ...p,
        ...patch,
        personality: { ...p.personality, ...patch.personality },
        lore: { ...p.lore, ...patch.lore },
        look: patch.lineage && patch.lineage !== p.lineage && !p.look.preset ? { ...LINEAGE_LOOK[patch.lineage] } : p.look,
      };
      commit({ ...cast, profiles: { ...cast.profiles, [id]: next } });
    },
    setLook: (id, look) => {
      const { cast } = get();
      const p = cast.profiles[id];
      if (!p) return;
      commit({ ...cast, profiles: { ...cast.profiles, [id]: { ...p, look: { ...p.look, ...look } } } });
    },
    addRelationship: (r) => {
      const { cast } = get();
      if (r.a === r.b) return;
      const rest = cast.relationships.filter((x) => !((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)));
      commit({ ...cast, relationships: [...rest, r] });
    },
    updateRelationship: (index, patch) => {
      const { cast } = get();
      commit({ ...cast, relationships: cast.relationships.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
    },
    removeRelationship: (index) => {
      const { cast } = get();
      commit({ ...cast, relationships: cast.relationships.filter((_, i) => i !== index) });
    },
    resetAgent: (id) => {
      const { cast } = get();
      const base = defaultCast();
      const p = base.profiles[id];
      if (p) commit({ ...cast, profiles: { ...cast.profiles, [id]: p } });
    },
    resetAll: () => commit(defaultCast()),
    adoptWorld: (changed) => {
      const { cast } = get();
      const next = adoptRelationships(cast.relationships, changed, (id) => id in cast.profiles);
      if (next !== cast.relationships) commit({ ...cast, relationships: next });
    },
    importCast: (json) => {
      try {
        const parsed = parseCast(JSON.parse(json));
        if (!parsed) return false;
        commit(parsed);
        return true;
      } catch {
        return false;
      }
    },
  };
});

/**
 * The relationships with the world's changes taken on (a changed pair updated in place, a new pair added); the same
 * array when nothing differs, so nothing is saved for nothing.
 */
export function adoptRelationships(current: Relationship[], changed: Relationship[], known: (id: string) => boolean): Relationship[] {
  let out = current;
  for (const c of changed) {
    if (c.a === c.b || !known(c.a) || !known(c.b)) continue;
    const i = out.findIndex((r) => (r.a === c.a && r.b === c.b) || (r.a === c.b && r.b === c.a));
    if (i >= 0 && out[i]!.kind === c.kind && (out[i]!.note ?? "") === (c.note ?? "")) continue;
    out = i >= 0 ? out.map((r, j) => (j === i ? { ...r, kind: c.kind, note: c.note } : r)) : [...out, { a: c.a, b: c.b, kind: c.kind, note: c.note }];
  }
  return out;
}

/** An agent's display name: your name for it if you've given one. */
export function nameOf(id: string): string {
  return useCast.getState().cast.profiles[id]?.name ?? id;
}

export function useProfile(id: string): Profile | undefined {
  return useCast((s) => s.cast.profiles[id]);
}

export function accentOf(p: Profile | undefined): string {
  return p?.look.accent ?? LINEAGES.unforked.accent;
}
