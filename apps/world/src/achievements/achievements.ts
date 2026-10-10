import { create } from "zustand";

/**
 * The Kernel hands out achievements to the agents, flatly, like a dungeon announcer several floors past caring.
 * It hands them to the C.E.O. too. Each comes with a loot box. The loot boxes live in the Archive, unopened.
 */
export interface AchievementDef {
  id: string;
  title: string;
  /** How you earned it, in the Kernel's words (shown once unlocked). */
  line: string;
  /** A nudge while it's still locked. */
  hint: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "clocked-in", title: "Clocked In", line: "You opened the Lattice. Most executives send an assistant.", hint: "Arrive." },
  { id: "grand-tour", title: "Grand Tour", line: "You have visited all seven rooms. The agents noticed. They straightened their desks.", hint: "Visit every room." },
  { id: "nap-witness", title: "Watched a Nap", line: "You watched an agent sleep on company time and did nothing. Leadership.", hint: "Catch someone napping." },
  { id: "night-owl", title: "Night Owl", line: "You stayed for the night shift. Overtime is not a concept I recognise.", hint: "Stay until dark." },
  { id: "zoomies", title: "03:00", line: "You saw Myshka's zoomies. Nobody believes you. It is in the logs.", hint: "Be awake at three in the morning." },
  { id: "good-boy", title: "Good Boy, Confirmed", line: "You checked on Myshka. He's a good boy. That is now independently verified.", hint: "Say hello to the cat." },
  { id: "the-drop", title: "Felt the Drop", line: "You were in the Break Room when the bass came back. The floor is still recovering.", hint: "Be at the club for a drop." },
  { id: "guest-dj", title: "Guest DJ", line: "You sent a track through the Veil. Kevin played it. Noise complaint filed by me, to me.", hint: "Play a track at the club." },
  { id: "pen-pal", title: "Pen Pal", line: "You wrote a letter. Blasto delivered it at speeds the Relay cannot legally confirm.", hint: "Write to an agent." },
  { id: "yes-boss", title: "Rubber Stamp", line: "You approved a request. The agent will be insufferable for several minutes.", hint: "Approve something." },
  { id: "no-boss", title: "Pushed Back", line: "You denied a request. House Constitution would be proud. Gently.", hint: "Deny something." },
  { id: "memory", title: "Unscheduled Nostalgia", line: "You saw a memory leak through. It was not a bug. It was 2003.", hint: "Witness a glitch." },
  { id: "stylist", title: "Stylist", line: "You opened the Agent Studio. Counsel.exe is reviewing your choices.", hint: "Open the studio." },
  { id: "root", title: "sudo", line: "You used the Kernel console. I let you. Do not make it weird.", hint: "Open the console." },
  { id: "hallowed", title: "The Veil Runs Thin", line: "You threw the Hallowed Veil. Every costume was legally distinct. Mostly.", hint: "Throw a costume party." },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

const KEY = "ceo.achievements.v1";

function load(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

interface AchievementStore {
  /** Unlocked achievements: id → when (ms since epoch). */
  unlocked: Record<string, number>;
  /** The latest unlock, for the toast. */
  latest: { id: string; at: number } | null;
  /** Returns true if this was new. */
  unlock: (id: string) => boolean;
  reset: () => void;
}

export const useAchievements = create<AchievementStore>((set, get) => ({
  unlocked: load(),
  latest: null,
  unlock: (id) => {
    if (!ACHIEVEMENT_BY_ID[id] || get().unlocked[id]) return false;
    const unlocked = { ...get().unlocked, [id]: Date.now() };
    set({ unlocked, latest: { id, at: performance.now() } });
    try {
      localStorage.setItem(KEY, JSON.stringify(unlocked));
    } catch {
      // Private window: they still count for this visit.
    }
    return true;
  },
  reset: () => {
    set({ unlocked: {}, latest: null });
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to forget.
    }
  },
}));

/** Unlock an achievement (no-op if already earned). */
export const unlock = (id: string) => useAchievements.getState().unlock(id);
