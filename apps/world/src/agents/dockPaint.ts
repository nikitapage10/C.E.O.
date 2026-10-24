import { Color, type MeshStandardMaterial } from "three";

/**
 * The dock crew's own paint: the rust frame's texture greyed down and washed in the crew member's colour, so Dusty,
 * Gusty and Musty read as three different salvage robots and none of them as Rusty. The Foundry paints them with it
 * in the Lattice, and the portrait studio for their Desk portraits.
 */
export function paintDock(mat: MeshStandardMaterial, colour: string): void {
  const tint = { value: new Color(colour) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaint = tint;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uPaint;")
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\n{ float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * l * 2.3, 0.9); }",
      );
  };
  mat.customProgramCacheKey = () => "dock-crew-paint";
  mat.needsUpdate = true;
}
