import { ShaderPass } from "postprocessing";
import { NoBlending, ShaderMaterial, Uniform } from "three";

/**
 * Scrubs invalid pixels before bloom. A single NaN or infinite pixel (a grazing-angle specular or sheen
 * highlight, an ambient-occlusion edge) is invisible on its own, but bloom's blur spreads it into a black
 * block that flickers as the camera moves. Clamping here keeps it a lone pixel.
 */
export function makeSanitizePass() {
  const material = new ShaderMaterial({
    name: "Sanitize",
    uniforms: { inputBuffer: new Uniform(null) },
    blending: NoBlending,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D inputBuffer;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(inputBuffer, vUv);
        bool bad = any(isnan(c)) || any(isinf(c));
        gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(clamp(c.rgb, 0.0, 64.0), clamp(c.a, 0.0, 1.0));
      }`,
  });
  return new ShaderPass(material, "inputBuffer");
}
