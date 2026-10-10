import { Color, ShaderMaterial } from "three";

/**
 * The view from the Spire: a high, pale sky over a sea of slow cloud, the tips of a few distant towers standing
 * out of it, and the sun low and warm. One plane behind the curtain wall, painted in the shader, with a touch
 * of parallax so it sits far away.
 */
export function penthouseSkyMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTop: { value: new Color("#7fa6d8") },
      uHorizon: { value: new Color("#f3d9c0") },
      uCloud: { value: new Color("#fbf6f0") },
      uShade: { value: new Color("#b9c2d4") },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vView = normalize(transpose(mat3(modelMatrix)) * (cameraPosition - world.xyz));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uCloud;
      uniform vec3 uShade;
      varying vec2 vUv;
      varying vec3 vView;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main() {
        // Parallax: far things shift with the view.
        vec2 uv = vUv + vec2(-vView.x, -vView.y) / max(vView.z, 0.3) * 0.05;
        float h = uv.y;
        vec3 col = mix(uHorizon, uTop, smoothstep(0.25, 1.0, h));
        // The sun, low on the right, with a broad glow.
        vec2 sun = vec2(0.78, 0.42);
        float d = length((uv - sun) * vec2(1.8, 1.0));
        col += vec3(1.0, 0.85, 0.6) * (exp(-d * 9.0) * 1.6 + exp(-d * 2.5) * 0.25);
        // Distant tower tips standing out of the cloud sea.
        float towers = 0.0;
        for (int i = 0; i < 7; i++) {
          float fi = float(i);
          float x = 0.08 + fi * 0.14 + sin(fi * 3.7) * 0.03;
          float w = 0.012 + fract(fi * 0.37) * 0.018;
          float top = 0.36 + fract(fi * 0.61) * 0.16;
          towers = max(towers, step(abs(uv.x - x), w) * step(h, top) * step(0.2, h));
          towers = max(towers, step(abs(uv.x - x), 0.002) * step(h, top + 0.06) * step(top, h));
        }
        col = mix(col, mix(uShade, uTop, 0.35) * 0.95, towers * 0.85);
        // The cloud sea: a soft top edge that rolls slowly.
        vec2 cp = vec2(uv.x * 3.0 + uTime * 0.008, h * 6.0);
        float edge = 0.3 + (fbm(cp * 1.2) - 0.5) * 0.12;
        float sea = smoothstep(edge + 0.03, edge - 0.05, h);
        float puff = fbm(vec2(uv.x * 7.0 - uTime * 0.012, h * 10.0));
        vec3 cloud = mix(uShade, uCloud, smoothstep(0.35, 0.75, puff) * 0.8 + smoothstep(0.0, 0.3, h) * 0.3);
        cloud += vec3(1.0, 0.85, 0.6) * exp(-length((uv - vec2(0.78, 0.3)) * vec2(1.4, 3.0)) * 3.0) * 0.35;
        col = mix(col, cloud, sea);
        // A few high wisps.
        float wisp = smoothstep(0.62, 0.8, fbm(vec2(uv.x * 2.0 + uTime * 0.004, h * 14.0))) * smoothstep(0.55, 0.85, h);
        col = mix(col, uCloud, wisp * 0.35);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    toneMapped: true,
  });
}
