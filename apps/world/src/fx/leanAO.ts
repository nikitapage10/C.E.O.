import { Color, Matrix4, type Camera, type Material, type Object3D, type Scene, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { cameraMovedSince } from "../scene/DetailLevels.tsx";

/** The members of n8ao's N8AOPostPass (n8ao 2.x) that this file touches. */
export interface AOPass {
  scene: Scene;
  camera: Camera;
  autoDetectTransparency: boolean;
  configuration: { transparencyAware: boolean; depthBufferType: number };
  renderTransparency(renderer: WebGLRenderer): void;
  depthTexture?: unknown;
  transparencyRenderTargetDWFalse?: WebGLRenderTarget | null;
  transparencyRenderTargetDWTrue?: WebGLRenderTarget | null;
  depthCopyPass?: {
    material: { uniforms: { depthTexture: { value: unknown }; reverseDepthBuffer: { value: boolean } } };
    render(renderer: WebGLRenderer): void;
  } | null;
}

/** n8ao's DepthType.Reverse. */
const REVERSE_DEPTH = 3;

type Drawn = Object3D & { material: Material & { depthWrite?: boolean } };

/**
 * What each of N8AO's two transparency draws sets an object's `visible` to, with n8ao 2.x's exact expressions.
 * They can yield `undefined` (a mesh with an array of materials), which three.js draws: only `false` hides. Kept
 * as is, so the draws match the original object for object.
 */
export function transparencySets(objects: readonly Drawn[], visible: readonly boolean[]) {
  const noDepthWrite: boolean[] = [];
  const depthWrite: boolean[] = [];
  objects.forEach((o, i) => {
    const m = o.material;
    const was = visible[i]!;
    noDepthWrite.push(was && ((m.transparent && !m.depthWrite && !o.userData.treatAsOpaque) || !!o.userData.cannotReceiveAO));
    depthWrite.push(was && m.transparent && (m.depthWrite as boolean) && !o.userData.treatAsOpaque);
  });
  return { noDepthWrite, depthWrite };
}

/**
 * The ambient occlusion pass, minus the work it repeats. Same pixels, less CPU per frame.
 *
 * To keep AO off glass, N8AO draws the scene twice more each frame (transparent surfaces only) into two targets,
 * and reads back just their alpha and depth. Around those draws it walked the whole scene four times (to note,
 * set, set and restore every object's visibility, through a Map), each draw went through the whole of
 * `renderer.render` (every matrix in the scene recomputed, the key light's shadow map re-rendered), and before all
 * that it walked the scene once more, every frame, to check whether anything in it is transparent.
 *
 * - The check runs once: the Lattice always has glass, so transparency stays on.
 * - One walk collects the objects with a material; the visibility flips run over that list.
 * - The two draws reuse the matrices the main pass computed a moment earlier in the same frame (nothing moves
 *   between the main pass and the AO pass).
 * - Neither draw redraws the shadow map: N8AO reads only alpha and depth, which shadows don't touch. (The second
 *   used to redraw it so the floor's reflection, drawn next frame before the main pass, saw a fresh one; nothing
 *   moves between the main pass and this one, so the main pass's map is the same map. #327: that was a whole
 *   shadow pass every frame.)
 * - While the camera holds still (the overview's idle drift counts as still: scene/DetailLevels.tsx,
 *   cameraMovedSince) the two draws are redone every TRANSPARENCY_EVERY frames and the targets keep what they held
 *   in between (#416). Glass doesn't move, so they hold the same thing; on the whole ring the two draws were some 350
 *   draw calls a frame. When the camera moves they are redone every frame.
 *
 * Returns a function that puts the pass back the way it was.
 */
/** How often, in frames, the transparency draws are redone while the camera holds still (#416). */
export const TRANSPARENCY_EVERY = 2;

export function leanAO(pass: AOPass): () => void {
  const autoDetect = pass.autoDetectTransparency;
  pass.autoDetectTransparency = false;
  pass.configuration.transparencyAware = true;

  const own = Object.prototype.hasOwnProperty.call(pass, "renderTransparency");
  const original = pass.renderTransparency;
  const objects: Drawn[] = [];
  const visible: boolean[] = [];
  const clear = new Color();
  const black = new Color(0, 0, 0);
  const seen = new Matrix4();
  let drawnAt = -Infinity;

  pass.renderTransparency = function (this: AOPass, renderer: WebGLRenderer) {
    const { scene, camera, depthCopyPass: copy } = this;
    const dwFalse = this.transparencyRenderTargetDWFalse;
    const dwTrue = this.transparencyRenderTargetDWTrue;
    // A newer n8ao that no longer looks like this: leave it to its own code.
    if (!copy || !dwFalse || !dwTrue) return original.call(this, renderer);
    // Still, and drawn a moment ago: the targets still hold this view's glass.
    const frame = renderer.info.render.frame;
    if (frame >= drawnAt && frame - drawnAt < TRANSPARENCY_EVERY && !cameraMovedSince(camera.matrixWorld, seen)) return;
    drawnAt = frame;
    seen.copy(camera.matrixWorld);

    objects.length = 0;
    visible.length = 0;
    scene.traverse((o) => {
      if (!(o as Drawn).material) return;
      objects.push(o as Drawn);
      visible.push(o.visible);
    });
    const { noDepthWrite, depthWrite } = transparencySets(objects, visible);

    const background = scene.background;
    renderer.getClearColor(clear);
    const clearAlpha = renderer.getClearAlpha();
    const autoClearDepth = renderer.autoClearDepth;
    const autoMatrix = scene.matrixWorldAutoUpdate;
    const autoShadow = renderer.shadowMap.autoUpdate;
    scene.background = null;
    renderer.autoClearDepth = false;
    renderer.setClearColor(black, 0);
    copy.material.uniforms.depthTexture.value = this.depthTexture;
    copy.material.uniforms.reverseDepthBuffer.value = this.configuration.depthBufferType === REVERSE_DEPTH;
    scene.matrixWorldAutoUpdate = false;
    try {
      // Transparent surfaces that don't write depth.
      renderer.setRenderTarget(dwFalse);
      for (let i = 0; i < objects.length; i++) objects[i]!.visible = noDepthWrite[i]!;
      renderer.clear(true, true, true);
      copy.render(renderer);
      renderer.shadowMap.autoUpdate = false;
      renderer.render(scene, camera);
      renderer.shadowMap.autoUpdate = autoShadow;
      // Transparent surfaces that do.
      renderer.setRenderTarget(dwTrue);
      for (let i = 0; i < objects.length; i++) objects[i]!.visible = depthWrite[i]!;
      renderer.clear(true, true, true);
      copy.render(renderer);
      renderer.shadowMap.autoUpdate = false;
      renderer.render(scene, camera);
    } finally {
      for (let i = 0; i < objects.length; i++) objects[i]!.visible = visible[i]!;
      scene.matrixWorldAutoUpdate = autoMatrix;
      renderer.shadowMap.autoUpdate = autoShadow;
      renderer.setClearColor(clear, clearAlpha);
      scene.background = background;
      renderer.autoClearDepth = autoClearDepth;
      objects.length = 0;
    }
  };

  return () => {
    pass.autoDetectTransparency = autoDetect;
    if (own) pass.renderTransparency = original;
    else delete (pass as Partial<AOPass>).renderTransparency;
  };
}
