/**
 * A picture of the page Nikita is looking at (#1027), taken in his browser with no prompt, only when Skippy asks to
 * look (his look_at_screen tool) or files a Foundry fix for a glitch on screen; never on every message. The DOM is
 * drawn by html-to-image (pinned); every <canvas> (the 3D rooms are WebGL) is read inside an animation frame, right
 * after the scene has drawn it, so a renderer without preserveDrawingBuffer still gives its picture. A scene that only
 * draws on demand registers its own render (`registerShotRender`), run just before it is read.
 *
 * Anything marked `data-shot-skip` (Skippy's own chat and the hold-Space caption) is left out, so the picture shows
 * the page under them. The picture goes only to the private store (POST /api/foundry-shot, `uploadShot`); nothing
 * about it is public.
 */

/** The longest edge of the picture: what Claude reads best, and small enough to upload in a moment. */
export const SHOT_EDGE = 1_568;
/** The largest upload: about 1.5 MB, well under the server's 3 MB. */
const SHOT_BYTES = 1_500_000;

const renders = new Map<HTMLCanvasElement, () => void>();

/** A scene that doesn't draw every frame says how to draw it now; the capture runs it just before reading the canvas. */
export function registerShotRender(canvas: HTMLCanvasElement, render: () => void): () => void {
  renders.set(canvas, render);
  return () => {
    if (renders.get(canvas) === render) renders.delete(canvas);
  };
}

const visible = (c: HTMLCanvasElement) => {
  const r = c.getBoundingClientRect();
  return c.width > 0 && c.height > 0 && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
};

/** Every visible canvas as a data URL, read in the frame right after its scene drew it. */
function snapCanvases(): Promise<Map<HTMLCanvasElement, string>> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const out = new Map<HTMLCanvasElement, string>();
      for (const c of Array.from(document.querySelectorAll("canvas"))) {
        if (!visible(c) || c.closest("[data-shot-skip]")) continue;
        try {
          renders.get(c)?.();
          out.set(c, c.toDataURL("image/png"));
        } catch {
          // A canvas that can't be read (tainted) is left as html-to-image finds it.
        }
      }
      resolve(out);
    });
  });
}

let fontCSS: Promise<string> | null = null;

/** The page's web fonts, embedded once a session (each capture after reuses them). */
async function fontsOnce(lib: typeof import("html-to-image"), node: HTMLElement): Promise<string | undefined> {
  fontCSS ??= Promise.race([lib.getFontEmbedCSS(node), new Promise<string>((r) => setTimeout(() => r(""), 4_000))]).catch(() => "");
  return (await fontCSS) || undefined;
}

/**
 * The page as a JPEG, at most SHOT_EDGE on its longest side: the part of the page on screen, with the 3D canvases
 * drawn in. Null when it couldn't be taken (an old browser, a page that won't draw).
 */
export async function captureScreen(): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  try {
    const lib = await import("html-to-image");
    const snaps = await snapCanvases();
    // html-to-image reads each canvas with toDataURL while it clones the page: it gets the frame read above.
    const restore: Array<() => void> = [];
    for (const [c, url] of snaps) {
      const own = Object.prototype.hasOwnProperty.call(c, "toDataURL");
      const was = c.toDataURL;
      c.toDataURL = () => url;
      restore.push(() => {
        if (own) c.toDataURL = was;
        else delete (c as { toDataURL?: unknown }).toDataURL;
      });
    }
    const w = innerWidth;
    const h = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, SHOT_EDGE / Math.max(w, h));
    const body = document.body;
    let canvas: HTMLCanvasElement;
    try {
      canvas = await lib.toCanvas(body, {
        width: w,
        height: h,
        canvasWidth: Math.round(w * ratio),
        canvasHeight: Math.round(h * ratio),
        pixelRatio: 1,
        backgroundColor: getComputedStyle(body).backgroundColor || getComputedStyle(document.documentElement).backgroundColor || "#0b0d12",
        style: { transform: `translate(${-scrollX}px, ${-scrollY}px)`, transformOrigin: "top left" },
        filter: (n) => !(n instanceof HTMLElement && n.hasAttribute("data-shot-skip")),
        fontEmbedCSS: await fontsOnce(lib, body),
        cacheBust: false,
        imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      });
    } finally {
      for (const r of restore) r();
    }
    for (const q of [0.82, 0.66, 0.5]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= SHOT_BYTES) return blob;
    }
    return null;
  } catch {
    return null;
  }
}

/** The picture into the private store (POST /api/foundry-shot, passkey session): its opaque id, or null. */
export async function uploadShot(blob: Blob, doFetch: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await doFetch("/api/foundry-shot", { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob, credentials: "same-origin" });
    const body = (await res.json().catch(() => ({}))) as { id?: unknown };
    return res.ok && typeof body.id === "string" && /^shot-[0-9a-f]{20}$/.test(body.id) ? body.id : null;
  } catch {
    return null;
  }
}

/** Look at the screen for Skippy: capture, keep privately, and the id to send back with the words. Null when it failed. */
export async function lookAtScreen(doFetch: typeof fetch = fetch): Promise<string | null> {
  const blob = await captureScreen();
  return blob ? uploadShot(blob, doFetch) : null;
}
