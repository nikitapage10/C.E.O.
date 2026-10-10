import { Color } from "three";

/** The Lattice palette: The Tide's silver-on-black, cooled down to what a computer might call cosy. */
export const PALETTE = {
  void: "#04060b",
  deep: "#070b14",
  panel: "#0b1220",
  line: "#1c2a3d",
  ice: "#8fe8ff",
  silver: "#e8f1ff",
  violet: "#9b8cff",
  mint: "#7dffc4",
  danger: "#ff6b8b",
  amber: "#ffd08f",
  absinthe: "#9dff6b",
} as const;

/** An HDR colour for emissive, un-tonemapped materials: values above 1 are what make bloom bloom. */
export function glow(hex: string, intensity = 2.5): Color {
  return new Color(hex).multiplyScalar(intensity);
}
