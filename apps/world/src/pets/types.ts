export type PetMode = "idle" | "walk" | "sit" | "nap" | "groom";

/** Written by the pet's controller every frame; read by its model. */
export interface PetDrive {
  mode: PetMode;
  /** Seconds, from the render clock. */
  t: number;
}
