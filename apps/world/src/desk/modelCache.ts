/**
 * Models loaded once per visit (#717). Nikita: "Once it loads once, it shouldn't have to reload those models again."
 * A loaded model (a parsed GLB) is kept here for the rest of the session, so leaving Today and coming back, or any
 * other Desk view that shows the same model, reuses it instead of fetching and decoding it again. Across visits the
 * browser keeps the file itself: modelUrl() gives each model a content-hashed path under /assets/, served as
 * immutable for a year (public/staticwebapp.config.json).
 *
 * No three.js here, so a page can ask whether a model is ready (and skip its loading wait) without pulling three in;
 * the caller hands in its own loader. Treat what comes back as read-only and clone it before posing or showing it.
 */

const loads = new Map<string, Promise<unknown>>();
const ready = new Set<string>();

/** The model at `key`, loaded by `load` the first time and shared from then on. A failed load is forgotten, so it can be tried again. */
export function cachedModel<T>(key: string, load: () => Promise<T>): Promise<T> {
  const had = loads.get(key);
  if (had) return had as Promise<T>;
  const p = load().then(
    (v) => {
      ready.add(key);
      return v;
    },
    (e: unknown) => {
      loads.delete(key);
      throw e;
    },
  );
  loads.set(key, p);
  return p;
}

/** Whether the model at `key` has already loaded this session. */
export const modelReady = (key: string) => ready.has(key);

/** Tests only: forget every model. */
export function clearModelCache() {
  loads.clear();
  ready.clear();
}
