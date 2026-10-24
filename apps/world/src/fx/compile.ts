import type { Camera, Material, Object3D, Scene, WebGLRenderer } from "three";

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

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** The parts to compile one at a time: the scene's children, with the rooms' group split into its rooms. */
function parts(root: Object3D): Object3D[] {
  return root.children.flatMap((c) => (c.children.some((g) => g.name.startsWith("room-")) ? c.children : [c]));
}

/**
 * Compile every material under `root` (hidden things included: three.js compiles them all), lit by `scene`'s
 * lights as they are now, and resolve once all of it can be drawn without a stall.
 */
export function compileScene(gl: WebGLRenderer, root: Object3D, camera: Camera, scene: Scene): Promise<void> {
  if (parallelCompile(gl)) return gl.compileAsync(root, camera, scene).then(() => undefined, () => undefined);
  const list = root === scene ? parts(root) : [root];
  return (async () => {
    for (const part of list) {
      const materials = gl.compile(part, camera, scene) as unknown as Set<Material>;
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
