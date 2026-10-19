/**
 * Where the Foundry's crew furniture stands (room-local x, z), shared by the room's stations (layout.ts), its
 * footprints (obstacles.ts) and the scene, so all three agree.
 *
 * - The dock: Rusty's dock crew (Dusty, Gusty and Musty) wait here, powered down, one to a bay, against the left
 *   wall and side-on to the hall. One wakes for each job really running past Rusty's own and rolls out to the line.
 * - The line spots: where each of the dock crew works the assembly line alongside Rusty, clear of the stretch he
 *   walks between the intake, the arm and the furnace.
 * - Rocky's drafting table, with the plan of the biggest open or upcoming idea pinned to it.
 * - Rivet's alarm post: a lamp on a pole showing the real state of the checks on main.
 * - The shipped wall (#182): a board of brass plaques, one for each change shipped this week, standing on the
 *   pegboard line just right of the pegboard and Rusty's idea board, facing the camera.
 * - Rusty's two workbenches (A and B): desks with two monitors each, toward the front of the hall in the middle,
 *   so the front left stays clear and the dock against the left wall is in full view (#110).
 */
export const FOUNDRY_FLOOR = {
  dock: { x: -7.25, z: 2.95, hw: 0.65, hd: 1.5 },
  /** Where each of the dock crew parks, facing into the hall (+x). */
  bays: [
    [-7.3, 1.95],
    [-7.3, 2.95],
    [-7.3, 3.95],
  ],
  /** Where each of the dock crew stands to work the line, facing the belt (-z): the intake end, then past the furnace. */
  lineSpots: [
    [-6.7, -1.45],
    [4.95, -1.45],
    [6.3, -1.45],
  ],
  drafting: { x: 5.3, z: 0.55, hw: 0.7, hd: 0.45 },
  alarmPost: { x: 1.9, z: 0, hw: 0.22, hd: 0.22 },
  shippedWall: { x: 4.5, z: 4.4, hw: 0.72, hd: 0.2 },
  /** Where Rusty stands at each workbench (A, then B), facing the camera (+z); the desk is 0.8 in front of him. */
  benches: [
    [-2.5, 3.2],
    [0, 3.2],
  ],
} as const;

/** How far in front of the standing spot a workbench's desk stands, and its half width and half depth. */
export const BENCH_DESK = { ahead: 0.8, hw: 0.9, hd: 0.4 } as const;

/** The footprint of the desk at each of Rusty's workbenches. */
export const benchDesks = () => FOUNDRY_FLOOR.benches.map(([x, z]) => ({ x, z: z + BENCH_DESK.ahead, hw: BENCH_DESK.hw, hd: BENCH_DESK.hd }));
