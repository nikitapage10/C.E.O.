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
const LOOKS_REV = 3;

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
      let rev = 0;
      try {
        rev = Number(localStorage.getItem(LOOKS_KEY) ?? 0);
      } catch {
        /* Unreadable: treat as old. */
      }
      if (rev < LOOKS_REV) {
        for (const [id, p] of Object.entries(base.profiles)) if (profiles[id]) profiles[id] = { ...profiles[id], look: p.look };
        try {
          localStorage.setItem(LOOKS_KEY, String(LOOKS_REV));
        } catch {
          /* Private mode: re-cast again next time, harmlessly. */
        }
      }
      return { ...parsed, profiles };
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
