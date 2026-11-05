import * as THREE from "three";

/**
 * The Haven's Denver night, in the house's own scene (#665, after #658's flat sky "didn't line up"). The house stands
 * on a dark plain, and the city's lights are points on that plain, laid along a street grid out into the haze. A dome
 * round it all holds the Front Range on the west horizon (three higher summits, foothills in front), a low warm city
 * glow, stars and a thin moon. The plain fades into the dome's horizon colour, so its vanishing line is the horizon:
 * turn or tilt the house and everything moves together. At the default three-quarter view the horizon is above the
 * frame (the lights run out to the top edge); tilt the house down to bring the range and the moon into view.
 *
 * Nothing is downloaded. The plain, the lights and the dome fade out towards the canvas's edges, so the scene melts
 * into the page round it. Reduced motion: no twinkle (the page draws a frame only when something changes). Phones
 * get fewer lights.
 */

export interface Night {
  group: THREE.Group;
  /** Per frame: the canvas size (device px), the time (s, frozen under reduced motion) and the camera. */
  update(w: number, h: number, t: number, camera: THREE.PerspectiveCamera, dpr: number): void;
  dispose(): void;
}

const GLSL_COMMON = `
const float PI=3.14159265;
const float TAU=6.2831853;
uniform vec2 uRes;
float edgeA(){vec2 uv=gl_FragCoord.xy/uRes;return smoothstep(0.,0.08,uv.x)*smoothstep(1.,0.92,uv.x)*smoothstep(0.,0.06,uv.y)*smoothstep(1.,0.92,uv.y);}
`;

const HAZE = "vec3(0.052,0.05,0.07)";

const GROUND_VS = `varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
const GROUND_FS = `${GLSL_COMMON}
varying vec3 vW;
void main(){
  float d=length(vW.xz-cameraPosition.xz);
  float hz=smoothstep(18.,420.,d);
  vec3 col=mix(vec3(0.03,0.032,0.044),${HAZE},pow(hz,0.75));
  col+=vec3(1.,0.6,0.32)*0.035*smoothstep(80.,600.,d);
  gl_FragColor=vec4(col,edgeA());
}`;

const LIGHTS_VS = `
uniform float uT;
uniform float uPx;
attribute vec3 aSeed;
varying float vB;
varying float vWarm;
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  float d=length(w.xyz-cameraPosition);
  float tw=0.8+0.2*sin(uT*(0.6+aSeed.z*2.)+aSeed.z*60.);
  vB=min(1.,aSeed.x*tw*(1.-0.75*smoothstep(120.,520.,d))*mix(1.5,1.,smoothstep(20.,90.,d)));
  vWarm=aSeed.y;
  gl_PointSize=uPx*mix(3.4,1.5,smoothstep(20.,180.,d));
  gl_Position=projectionMatrix*viewMatrix*w;
}`;
const LIGHTS_FS = `${GLSL_COMMON}
varying float vB;
varying float vWarm;
void main(){
  float r=length(gl_PointCoord-0.5);
  float a=clamp(smoothstep(0.5,0.05,r)*0.7+smoothstep(0.25,0.,r),0.,1.)*vB*edgeA();
  vec3 c=mix(vec3(1.,0.68,0.38),vec3(0.95,0.92,0.84),step(0.72,vWarm));
  gl_FragColor=vec4(c,a);
}`;

const DOME_VS = GROUND_VS;
const DOME_FS = `${GLSL_COMMON}
uniform float uT;
uniform float uWest;
uniform float uPix;
varying vec3 vW;
float wrapA(float a){return mod(a+PI,TAU)-PI;}
float h1(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float bump(float a,float c,float w){float d=abs(wrapA(a-c))/w;return exp(-d*(1.+d));}
float range(float a){
  float env=smoothstep(1.75,0.55,abs(wrapA(a)));
  float r=0.02+0.009*sin(5.*a+1.3)+0.006*sin(11.*a+0.4)+0.005*abs(sin(23.*a+2.1))+0.004*abs(sin(47.*a+0.7))+0.0028*abs(sin(101.*a+1.9))+0.0016*abs(sin(211.*a+0.3))+0.0008*abs(sin(433.*a));
  r+=0.050*bump(a,-0.42,0.07)+0.034*bump(a,-0.3,0.15);
  r+=0.054*bump(a,0.06,0.08)+0.03*bump(a,0.18,0.12);
  r+=0.036*bump(a,0.55,0.065);
  return 0.6*(0.004+env*r);
}
float hills(float a){
  float env=smoothstep(1.45,0.4,abs(wrapA(a)));
  float r=0.008+0.004*sin(9.*a+2.)+0.003*sin(19.*a+0.3)+0.002*abs(sin(41.*a+1.1))+0.0012*abs(sin(131.*a+0.6))+0.0006*abs(sin(307.*a));
  return 0.6*(0.002+env*r);
}
vec3 dots(vec2 q,float cell,float n,float dens,float scale){
  vec2 c=floor(q/cell);
  vec2 cw=vec2(mod(c.x,n),c.y);
  float k=h1(cw);
  if(k>dens)return vec3(0.);
  vec2 o=(vec2(h1(cw+7.1),h1(cw+3.7))*0.8+0.1)*cell;
  float d=length(q-c*cell-o)*scale;
  return vec3(exp(-d*d*1.6),h1(cw+1.9),h1(cw+5.3));
}
void main(){
  vec3 dir=normalize(vW-cameraPosition);
  float alt=asin(clamp(dir.y,-1.,1.));
  float a=wrapA(atan(dir.x,dir.z)-uWest);
  vec3 warm=vec3(1.,0.6,0.32);
  float up=max(alt,0.);
  vec3 col=mix(${HAZE}+warm*0.07,vec3(0.012,0.016,0.035),smoothstep(0.,0.5,up))+warm*0.035*exp(-up/0.12);
  float mask=smoothstep(0.015,0.09,alt);
  vec2 q=vec2(a*cos(min(up,1.2)),alt);
  float px=1./uPix;
  vec3 s=dots(q,0.011,floor(TAU/0.011),0.16,px);
  col+=vec3(0.82,0.87,1.)*s.x*(0.12+0.88*pow(s.y,4.))*(0.72+0.28*sin(uT*(1.+3.*s.z)+s.z*40.))*mask;
  vec3 s2=dots(q+0.37,0.043,floor(TAU/0.043),0.09,px*0.55);
  col+=vec3(1.,0.95,0.86)*s2.x*s2.y*0.9*mask*(0.85+0.15*sin(uT*2.+s2.z*30.));
  vec2 dm=vec2(wrapA(a+0.32),alt-0.075);
  float R=0.0085,ld=length(dm);
  float disc=smoothstep(R,R-1.5*uPix,ld);
  float bite=smoothstep(R*1.02,R*1.02-1.5*uPix,length(dm-vec2(-0.0055,0.0016)));
  col+=vec3(0.96,0.92,0.84)*disc*(1.-bite)*0.95+vec3(0.6,0.62,0.7)*0.05*exp(-ld/0.03);
  float rr=range(a),hh=hills(a);
  if(alt<rr)col=mix(vec3(0.028,0.031,0.05),vec3(0.05,0.05,0.075),smoothstep(0.,rr,alt)*0.55)+warm*0.012;
  if(alt<hh)col=vec3(0.018,0.019,0.03);
  if(alt<0.)col=${HAZE}+warm*0.035;
  gl_FragColor=vec4(col,edgeA());
}`;

/** The lights on the plain: a street grid round the house, thinning nowhere, fading into the haze. */
export function cityLights(n: number, keep: { x0: number; x1: number; z0: number; z1: number }, seed = 3): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647), s / 2147483647);
  const out = new Float32Array(n * 3);
  // The streets next to the house (in step with its walls) hold a good share, then the town, then the plain out to
  // the haze: the camera mostly sees the first ring, the horizon the last.
  const B = 6, rings: [number, number, number][] = [[7.5, 36, 0.2], [36, 140, 0.38], [140, 540, 1]];
  let i = 0, guard = 0;
  while (i < n && guard++ < n * 20) {
    const [a, b] = rings.find((g) => i < n * g[2])!;
    const r = Math.sqrt(rnd() * (b * b - a * a) + a * a), an = rnd() * Math.PI * 2;
    let x = Math.cos(an) * r, z = Math.sin(an) * r;
    const k = rnd();
    if (k < 0.47) x = Math.round(x / B) * B + (rnd() - 0.5) * 0.12;
    else if (k < 0.94) z = Math.round(z / B) * B + (rnd() - 0.5) * 0.12;
    if (x > keep.x0 - 2.5 && x < keep.x1 + 2.5 && z > keep.z0 - 2.5 && z < keep.z1 + 2.5) continue;
    out[i * 3] = x;
    out[i * 3 + 1] = 0.02;
    out[i * 3 + 2] = z;
    i++;
  }
  return out.subarray(0, i * 3);
}

export function makeNight(o: { centre: [number, number]; keep: { x0: number; x1: number; z0: number; z1: number }; west: number; phone: boolean }): Night {
  const group = new THREE.Group();
  const res = { value: new THREE.Vector2(1, 1) };
  const uT = { value: 0 };

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 48, 24),
    new THREE.ShaderMaterial({ uniforms: { uRes: res, uT, uWest: { value: o.west }, uPix: { value: 0.001 } }, vertexShader: DOME_VS, fragmentShader: DOME_FS, side: THREE.BackSide, transparent: true, depthWrite: false }),
  );
  dome.renderOrder = -20;
  dome.frustumCulled = false;
  group.add(dome);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.ShaderMaterial({ uniforms: { uRes: res }, vertexShader: GROUND_VS, fragmentShader: GROUND_FS, transparent: true, depthWrite: false }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(o.centre[0], -0.012, o.centre[1]);
  ground.renderOrder = -10;
  group.add(ground);

  const pos = cityLights(o.phone ? 9000 : 22000, { x0: o.keep.x0 - o.centre[0], x1: o.keep.x1 - o.centre[0], z0: o.keep.z0 - o.centre[1], z1: o.keep.z1 - o.centre[1] });
  const count = pos.length / 3;
  const seeds = new Float32Array(count * 3);
  let s = 17;
  for (let i = 0; i < seeds.length; i++) {
    s = (s * 16807) % 2147483647;
    seeds[i] = s / 2147483647;
  }
  for (let i = 0; i < count; i++) seeds[i * 3] = 0.45 + 0.55 * Math.pow(seeds[i * 3]!, 2);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  lg.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
  const lm = new THREE.ShaderMaterial({ uniforms: { uRes: res, uT, uPx: { value: 1 } }, vertexShader: LIGHTS_VS, fragmentShader: LIGHTS_FS, transparent: true, depthWrite: false });
  const lights = new THREE.Points(lg, lm);
  lights.position.set(o.centre[0], 0, o.centre[1]);
  lights.renderOrder = -5;
  lights.frustumCulled = false;
  group.add(lights);

  return {
    group,
    update(w, h, t, camera, dpr) {
      res.value.set(w, h);
      uT.value = t;
      (dome.material as THREE.ShaderMaterial).uniforms.uPix!.value = ((camera.fov * Math.PI) / 180) / Math.max(1, h);
      lm.uniforms.uPx!.value = dpr;
      dome.position.copy(camera.position);
    },
    dispose() {
      dome.geometry.dispose();
      (dome.material as THREE.Material).dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      lg.dispose();
      lm.dispose();
    },
  };
}
