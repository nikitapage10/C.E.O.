import { Color, MeshPhysicalMaterial, MeshStandardMaterial, type Material } from "three";
import { blackGlassFloor, brushedMetal, carpet, concrete, felt, grating, roughnessNoise, terrazzo, woodGrain } from "./textures.ts";

/**
 * Physically based materials, lit by the studio environment. These replace the old all-glowing glass:
 * real surfaces reflect real light, and only true light sources glow.
 */
const cache = new Map<string, Material>();
function once<T extends Material>(key: string, build: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = build();
    cache.set(key, m);
  }
  return m;
}

export const PBR = {
  /** Dark graphite steel: beams, machinery, frames. */
  steel: () =>
    once("steel", () => new MeshStandardMaterial({ color: "#2b3038", metalness: 0.85, roughness: 0.38, roughnessMap: brushedMetal(), envMapIntensity: 1.2 })),
  /** Bright brushed aluminium. */
  aluminium: () =>
    once("alu", () => new MeshStandardMaterial({ color: "#c4cad3", metalness: 1, roughness: 0.28, roughnessMap: brushedMetal(), envMapIntensity: 1.1 })),
  chrome: () => once("chrome", () => new MeshStandardMaterial({ color: "#e6ebf2", metalness: 1, roughness: 0.06 })),
  brass: () => once("brass", () => new MeshStandardMaterial({ color: "#c9a25c", metalness: 1, roughness: 0.3, roughnessMap: roughnessNoise([1, 1]) })),
  copper: () => once("copper", () => new MeshStandardMaterial({ color: "#c27a52", metalness: 1, roughness: 0.34, roughnessMap: roughnessNoise([1, 1]) })),
  blackMetal: () => once("blackmetal", () => new MeshStandardMaterial({ color: "#0e1014", metalness: 0.7, roughness: 0.45 })),
  /** Satin lacquer in any colour: furniture, machines, appliances. */
  lacquer: (color: string, roughness = 0.35) =>
    once(`lacquer-${color}-${roughness}`, () => new MeshPhysicalMaterial({ color, metalness: 0, roughness, clearcoat: 0.6, clearcoatRoughness: 0.2 })),
  /** Matte painted / plaster surfaces. */
  matte: (color: string, roughness = 0.85) => once(`matte-${color}-${roughness}`, () => new MeshStandardMaterial({ color, roughness, metalness: 0 })),
  fabric: (color: string) =>
    once(`fabric-${color}`, () => new MeshPhysicalMaterial({ color, roughness: 0.95, sheen: 1, sheenRoughness: 0.6, sheenColor: new Color(color).lerp(new Color("#ffffff"), 0.35) })),
  /** Clear architectural glass. */
  glass: (tint = "#cfe6ff", opacity = 0.18) =>
    once(
      `glass-${tint}-${opacity}`,
      () => new MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.04, transparent: true, opacity, envMapIntensity: 1.6, clearcoat: 1, depthWrite: false }),
    ),
  frosted: (tint = "#dfe9f5") =>
    once(`frosted-${tint}`, () => new MeshPhysicalMaterial({ color: tint, roughness: 0.55, transmission: 0, transparent: true, opacity: 0.55, depthWrite: false })),

  // Floors
  concreteFloor: (repeat: [number, number] = [3, 3]) =>
    once(`concrete-${repeat}`, () => new MeshStandardMaterial({ map: concrete(repeat), roughness: 0.82, roughnessMap: roughnessNoise(repeat), metalness: 0.05 })),
  terrazzoFloor: (repeat: [number, number] = [4, 4]) =>
    once(`terrazzo-${repeat}`, () => new MeshPhysicalMaterial({ map: terrazzo(repeat), roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.12 })),
  blackFloor: (repeat: [number, number] = [6, 6]) =>
    once(`blackfloor-${repeat}`, () => new MeshPhysicalMaterial({ map: blackGlassFloor(repeat), roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })),
  gratingFloor: (repeat: [number, number] = [8, 8]) =>
    once(`grating-${repeat}`, () => new MeshStandardMaterial({ map: grating(repeat), metalness: 0.8, roughness: 0.5 })),
  wood: (tone: "walnut" | "oak", repeat: [number, number] = [1, 1]) =>
    once(`wood-${tone}-${repeat}`, () => new MeshPhysicalMaterial({ map: woodGrain(tone, repeat), roughness: 0.48, clearcoat: tone === "walnut" ? 0.5 : 0.25, clearcoatRoughness: 0.3 })),
  carpet: (color: string, repeat: [number, number] = [3, 3]) =>
    once(`carpet-${color}-${repeat}`, () => new MeshStandardMaterial({ map: carpet(color, repeat), roughness: 1 })),
  felt: (color: string) => once(`felt-${color}`, () => new MeshStandardMaterial({ map: felt(color), roughness: 1 })),

  /** A real light source: emissive, unlit, blooms. Use sparingly; that is the whole point. */
  light: (color: string, intensity = 3) =>
    once(`light-${color}-${intensity}`, () => new MeshStandardMaterial({ color: "#000000", emissive: color, emissiveIntensity: intensity, toneMapped: false })),
};
