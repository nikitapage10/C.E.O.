import type { HavenPlan } from "./planShape.ts";

/**
 * A made-up home for tests, the e2e run and screenshots (#616): a generic flat with a gym block below it. It is not
 * Nikita's home and never stands in for it; their plan lives only in the private store. Imported by tests only.
 */
export const FAKE_PLAN: HavenPlan = {
  v: 1,
  w: 1000,
  h: 1300,
  rooms: [
    { id: "hall", name: "Hall", parts: [[40, 40, 180, 500]], floor: "wood", tab: "hall", vacuum: "Hall", detached: false },
    { id: "kitchen", name: "Kitchen", parts: [[220, 40, 380, 280]], floor: "wood", tab: "kitchen", vacuum: "Kitchen", detached: false },
    { id: "nook", name: "Dining", parts: [[220, 320, 380, 140]], floor: "wood", tab: "pets", vacuum: "Dining", detached: false },
    { id: "living", name: "Living room", parts: [[600, 40, 360, 420]], floor: "wood", tab: null, vacuum: "Living room", detached: false },
    { id: "bath", name: "Bath", parts: [[40, 540, 180, 260]], floor: "tile", tab: null, vacuum: null, detached: false },
    { id: "bedroom", name: "Bedroom", parts: [[220, 460, 440, 340]], floor: "carpet", tab: null, vacuum: "Bedroom", detached: false },
    { id: "study", name: "Study", parts: [[660, 460, 300, 340]], floor: "wood", tab: null, vacuum: "Study", detached: false },
    { id: "gym", name: "Gym", parts: [[180, 900, 640, 360]], floor: "rubber", tab: "gym", vacuum: null, detached: true },
  ],
  doors: [
    [90, 40, 170, 40], [220, 120, 220, 220], [300, 320, 520, 320], [600, 340, 600, 440], [80, 540, 160, 540],
    [220, 470, 220, 530], [660, 560, 660, 660], [180, 1040, 180, 1120],
  ],
  windows: [
    [300, 40, 520, 40], [660, 40, 900, 40], [960, 100, 960, 300], [960, 520, 960, 640], [300, 800, 600, 800], [300, 1260, 700, 1260],
  ],
  // Made-up balcony doors: one off the living room, one off the study (#747).
  balconies: [[960, 330, 960, 420], [960, 670, 960, 760]],
  // The made-up living room's TV wall: the solid wall facing its windows.
  tv: [[600, 40, 600, 300]],
  openings: true,
  items: [
    { k: "counter", x: 224, y: 44, w: 300, h: 30, round: false }, { k: "upper", x: 224, y: 42, w: 300, h: 12, round: false },
    { k: "range", x: 360, y: 46, w: 60, h: 26, round: false }, { k: "sink", x: 260, y: 48, w: 50, h: 22, round: false },
    { k: "fridge", x: 532, y: 44, w: 62, h: 60, round: false }, { k: "island", x: 300, y: 160, w: 200, h: 60, round: false },
    { k: "stool", x: 340, y: 245, w: 22, h: 22, round: true }, { k: "stool", x: 400, y: 245, w: 22, h: 22, round: true }, { k: "stool", x: 460, y: 245, w: 22, h: 22, round: true },
    { k: "jar", x: 250, y: 300, w: 16, h: 16, round: true }, { k: "jar", x: 280, y: 300, w: 16, h: 16, round: true },
    { k: "table", x: 250, y: 332, w: 120, h: 60, round: false }, { k: "chair", x: 270, y: 334, w: 20, h: 20, round: true }, { k: "chair", x: 340, y: 334, w: 20, h: 20, round: true },
    { k: "console", x: 640, y: 44, w: 220, h: 16, round: false }, { k: "tv", x: 650, y: 42, w: 200, h: 5, round: false },
    { k: "sofa", x: 890, y: 120, w: 60, h: 280, round: false }, { k: "sofa", x: 660, y: 390, w: 230, h: 56, round: false },
    { k: "ctable", x: 720, y: 220, w: 90, h: 90, round: false }, { k: "lamp", x: 880, y: 420, w: 14, h: 14, round: true }, { k: "cattree", x: 630, y: 120, w: 28, h: 28, round: true },
    { k: "runner", x: 100, y: 120, w: 50, h: 360, round: false }, { k: "mat", x: 90, y: 46, w: 80, h: 30, round: false },
    { k: "plant", x: 60, y: 90, w: 30, h: 50, round: false }, { k: "petbed", x: 160, y: 200, w: 30, h: 30, round: true },
    { k: "tub", x: 50, y: 700, w: 100, h: 90, round: false }, { k: "vanity", x: 50, y: 560, w: 70, h: 30, round: false }, { k: "wc", x: 190, y: 640, w: 24, h: 24, round: true },
    { k: "bed", x: 320, y: 540, w: 190, h: 200, round: false }, { k: "night", x: 300, y: 550, w: 22, h: 22, round: true }, { k: "night", x: 532, y: 550, w: 22, h: 22, round: true },
    { k: "dresser", x: 560, y: 760, w: 90, h: 30, round: false }, { k: "rug", x: 300, y: 520, w: 240, h: 250, round: false },
    { k: "desk", x: 890, y: 490, w: 60, h: 240, round: false }, { k: "monitor", x: 920, y: 540, w: 7, h: 50, round: false }, { k: "monitor", x: 920, y: 620, w: 7, h: 50, round: false },
    { k: "ochair", x: 860, y: 600, w: 34, h: 34, round: true }, { k: "loveseat", x: 690, y: 560, w: 50, h: 160, round: false }, { k: "printer", x: 790, y: 760, w: 40, h: 30, round: false },
    { k: "gmat", x: 200, y: 920, w: 600, h: 320, round: false }, { k: "rack", x: 230, y: 940, w: 110, h: 80, round: false }, { k: "rack", x: 380, y: 940, w: 110, h: 80, round: false },
    { k: "barbell", x: 220, y: 976, w: 140, h: 5, round: false }, { k: "bench", x: 560, y: 960, w: 30, h: 100, round: false }, { k: "bench", x: 630, y: 960, w: 30, h: 100, round: false },
    { k: "dbrack", x: 240, y: 1200, w: 240, h: 26, round: false }, { k: "treadmill", x: 700, y: 940, w: 70, h: 160, round: false }, { k: "bike", x: 700, y: 1130, w: 40, h: 90, round: false },
    { k: "kettle", x: 530, y: 1180, w: 20, h: 20, round: true }, { k: "mirror", x: 196, y: 1100, w: 6, h: 140, round: false },
  ],
  devices: [
    { kind: "vacuum", x: 70, y: 430, lift: 0, lights: null },
    { kind: "wet-feeder", x: 420, y: 446, lift: 0, lights: null },
    { kind: "dry-feeder", x: 460, y: 446, lift: 0, lights: null },
    { kind: "fountain", x: 500, y: 446, lift: 0, lights: null },
    { kind: "litter", x: 84, y: 500, lift: 0, lights: null },
    { kind: "thermostat", x: 560, y: 456, lift: 52, lights: "living" },
  ],
  path: [[130, 40], [130, 14], [14, 14], [14, 1080], [180, 1080]],
};
