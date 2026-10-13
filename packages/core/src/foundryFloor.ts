/**
 * Where the Foundry's crew furniture stands (room-local x, z), shared by the room's stations (layout.ts), its
 * footprints (obstacles.ts) and the scene, so all three agree.
 *
 * - The dock: Rusty's spare units wait here, powered down, one to a bay, facing the hall. A spare wakes and rolls
 *   out when Rusty has more than one job in hand.
 * - The spare bench: one long bench with a spot for each spare, where a woken unit takes its job.
 * - Rocky's drafting table, with the plan of the biggest open or upcoming idea pinned to it.
 * - Rivet's alarm post: a lamp on a pole showing the real state of the checks on main.
 */
export const FOUNDRY_FLOOR = {
  dock: { x: -2.7, z: 0.2, hw: 1.6, hd: 0.65 },
  /** Where each spare unit parks, facing +z. */
  bays: [
    [-3.7, 0.3],
    [-2.7, 0.3],
    [-1.7, 0.3],
  ],
  spareBench: { x: 5.6, z: 4.45, hw: 1.7, hd: 0.4 },
  /** Where each spare stands to work at the spare bench, facing the camera (+z). */
  spareSpots: [
    [4.5, 3.7],
    [5.6, 3.7],
    [6.7, 3.7],
  ],
  drafting: { x: 5.3, z: 0.55, hw: 0.7, hd: 0.45 },
  alarmPost: { x: 1.9, z: 0, hw: 0.22, hd: 0.22 },
} as const;
