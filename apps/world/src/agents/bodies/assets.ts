import type { Body } from "@ceo/core";
import { libUrl, modelUrl } from "../../fx/library.ts";
import { MODEL as BLASTO } from "./Hanar.tsx";
import { LIBRARY_BODIES } from "./Library.tsx";
import { KAYKIT, KAYKIT_ANIMS_URL, ROBOT_URL, url } from "./Rigged.tsx";
import { MODEL as ROCKY } from "./Rocky.tsx";

/** Compactor.tsx's model, exactly as that file asks for it. */
const COMPACTOR_URL = modelUrl("compactor.glb");

/** The model files a body needs (its mesh and any shared clip file), so they can be fetched before it mounts. */
export function bodyModels(body: Body): string[] {
  const lib = LIBRARY_BODIES[body];
  if (lib) return lib.anims ? [libUrl(lib.model), libUrl(`anims/${lib.anims}`)] : [libUrl(lib.model)];
  if (body === "robot") return [ROBOT_URL];
  if (body in KAYKIT) return [url(KAYKIT[body as keyof typeof KAYKIT].file), KAYKIT_ANIMS_URL];
  if (body === "rocky") return [libUrl(ROCKY)];
  if (body === "hanar") return [libUrl(BLASTO)];
  if (body === "compactor") return [COMPACTOR_URL];
  // The classic figure, the monolith and the two droids are built in code.
  return [];
}
