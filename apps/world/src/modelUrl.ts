// Kept apart from fx/library.ts (which brings in three.js) so the Desk can name the Lattice's models too
// (latticeWarm.ts) without loading the Lattice.

/** Each model's content hash, from vite.config.ts (absent in tests). */
declare const __MODEL_VERSIONS__: Record<string, string> | undefined;
const VERSIONS: Record<string, string> = typeof __MODEL_VERSIONS__ === "undefined" ? {} : __MODEL_VERSIONS__;

/**
 * A model under public/models ("lib/custom/Rocky.glb"). The built site serves it from a path carrying its content
 * hash (`assets/models/lib/custom/Rocky.<hash>.glb`, vite.config.ts hashedModels), so the browser keeps it for good on
 * both hosts and still fetches a new one as soon as the file changes. The dev server serves public/models as it is.
 */
export function modelUrl(path: string) {
  const v = VERSIONS[path];
  if (v && import.meta.env.PROD) return `${import.meta.env.BASE_URL}assets/models/${path.replace(/\.glb$/, "")}.${v}.glb`;
  return `${import.meta.env.BASE_URL}models/${path}${v ? `?v=${v}` : ""}`;
}

/** Every model the site ships, as the app asks for it. */
export const allModelUrls = () => Object.keys(VERSIONS).map(modelUrl);
