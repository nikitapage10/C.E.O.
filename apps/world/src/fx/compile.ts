import { WebGLRenderTarget, type Camera, type Material, type Object3D, type Scene, type WebGLRenderer } from "three";

/**
 * Compiling the Lattice's shaders without freezing the page (#327).
 *
 * - Where the browser can link shader programs on its own threads (KHR_parallel_shader_compile: Chrome on Windows,
 *   macOS and Android), every program is started at once with compileAsync and the page waits for them without
 *   blocking, so a machine with many cores links them side by side.
 * - Elsewhere, linking happens the first time a program is used and the page waits for it there. Left to the first
 *   frame, that is one long freeze for all of them at once (the loading screen stops moving). Here the scene is
 *   compiled a part at a time instead (each room, the Kernel, the floor...), each part's programs are made ready in
 *   one task, and the page gets a turn in between.
 */

/** Whether this renderer can link programs off the page's thread. */
export const parallelCompile = (gl: WebGLRenderer) => gl.extensions.get("KHR_parallel_shader_compile") !== null;

/** Streamed parts (fx/Warm.tsx) whose shaders are still compiling; scene/streaming.ts's streamedIn reads it. */
export const warming = { count: 0 };

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** The parts to compile one at a time: the scene's children, with the rooms' group split into its rooms. */
function parts(root: Object3D): Object3D[] {
  return root.children.flatMap((c) => (c.children.some((g) => g.name.startsWith("room-")) ? c.children : [c]));
}

/**
 * A compile that builds the programs the frames will use (#416), or three.js builds them twice: once here and again,
 * unwarmed, in the first frames that draw them.
 *
 * - Every frame of the Lattice is drawn into a render target (the effect composer's buffers, the floor mirror's map,
 *   the shadow map), never straight to the canvas, and a material drawn to a target gets a different program (linear
 *   output) from one drawn to the canvas (sRGB output). So the compile runs with a target bound.
 * - three.js counts the lights of the scene and then those of the part being compiled, for a part that isn't in the
 *   scene yet. Ours always is, so a room's lamps counted twice and its programs were built for twice the lights. The
 *   part's own walk for lights runs once, inside the scene's.
 */
let target: WebGLRenderTarget | null = null;
function compileAs<T>(gl: WebGLRenderer, part: Object3D, scene: Scene, run: () => T): T {
  const before = gl.getRenderTarget();
  target ??= new WebGLRenderTarget(1, 1);
  if (!before) gl.setRenderTarget(target);
  const walk = part.traverseVisible;
  let walks = 0;
  if (part !== scene)
    part.traverseVisible = function (this: Object3D, cb) {
      if (walks++ === 0) walk.call(this, cb);
    };
  try {
    return run();
  } finally {
    if (part !== scene) delete (part as { traverseVisible?: unknown }).traverseVisible;
    if (!before) gl.setRenderTarget(before);
  }
}

/**
 * Compile every material under `root` (hidden things included: three.js compiles them all), lit by `scene`'s
 * lights as they are now, and resolve once all of it can be drawn without a stall.
 */
export function compileScene(gl: WebGLRenderer, root: Object3D, camera: Camera, scene: Scene): Promise<void> {
  if (parallelCompile(gl)) return compileAs(gl, root, scene, () => gl.compileAsync(root, camera, scene)).then(() => undefined, () => undefined);
  const list = root === scene ? parts(root) : [root];
  return (async () => {
    for (const part of list) {
      const materials = compileAs(gl, part, scene, () => gl.compile(part, camera, scene)) as unknown as Set<Material>;
      // Using a program waits for it to link: do it here, a part per task, not all at once in the first frame.
      for (const m of materials) {
        const program = (gl.properties.get(m) as { currentProgram?: { getUniforms(): unknown } }).currentProgram;
        try {
          program?.getUniforms();
        } catch {
          // A program that failed to link is reported when it's drawn, as before.
        }
      }
      await nextTask();
    }
  })();
}
