/**
 * The Haven's night sky (#658): a Denver night behind the house. The Front Range runs along the west horizon (three
 * high summits: one north, one straight ahead, a far hazy one south), foothills in front of it, the city's warm glow
 * low on the sky and its lights scattered on the plains below, stars above, and a thin moon. All of it is one small
 * fragment shader on its own canvas under the house and the flow lines, so nothing is downloaded.
 *
 * It is a panorama tied to the house's camera: turn the house and the range slides past (a full turn goes all the way
 * round, the west always behind the default view); tilt it down and the horizon climbs out of the frame. Reduced
 * motion: no twinkle, and a frame only when the camera moves. Phones draw it at a lower pixel ratio.
 */

const VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

const FS = `precision mediump float;
uniform vec2 uRes;
uniform float uAz;
uniform float uHy;
uniform float uT;
uniform float uDpr;
uniform float uMoon;
const float PI=3.14159265;
const float TAU=6.2831853;
const float SPAN=0.9;
float wrapA(float a){return mod(a+PI,TAU)-PI;}
float h1(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float bump(float a,float c,float w){float d=abs(wrapA(a-c))/w;return exp(-d*(1.+d));}
float range(float a){
  float env=smoothstep(1.75,0.55,abs(wrapA(a)));
  float r=0.02+0.009*sin(5.*a+1.3)+0.006*sin(11.*a+0.4)+0.005*abs(sin(23.*a+2.1))+0.004*abs(sin(47.*a+0.7))+0.0028*abs(sin(101.*a+1.9))+0.0016*abs(sin(211.*a+0.3))+0.0008*abs(sin(433.*a));
  r+=0.050*bump(a,-0.42,0.07)+0.034*bump(a,-0.3,0.15);
  r+=0.054*bump(a,0.06,0.08)+0.03*bump(a,0.18,0.12);
  r+=0.036*bump(a,0.55,0.065);
  return 0.004+env*r;
}
float hills(float a){
  float env=smoothstep(1.45,0.4,abs(wrapA(a)));
  float r=0.008+0.004*sin(9.*a+2.)+0.003*sin(19.*a+0.3)+0.002*abs(sin(41.*a+1.1))+0.0012*abs(sin(131.*a+0.6))+0.0006*abs(sin(307.*a));
  return 0.002+env*r;
}
vec3 dots(vec2 q,float cell,float n,float dens,float px){
  vec2 c=floor(q/cell);
  vec2 cw=vec2(mod(c.x,n),c.y);
  float k=h1(cw);
  if(k>dens)return vec3(0.);
  vec2 o=(vec2(h1(cw+7.1),h1(cw+3.7))*0.8+0.1)*cell;
  float d=length(q-c*cell-o)*px;
  float b=h1(cw+1.9);
  return vec3(exp(-d*d*1.6),b,h1(cw+5.3));
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  float a=uAz-(uv.x-0.5)*asp*SPAN;
  float alt=uv.y-uHy;
  float px=uRes.y;
  vec2 q=vec2(a/SPAN,alt);
  float edge=smoothstep(0.,0.07,uv.x)*smoothstep(1.,0.93,uv.x)*smoothstep(1.,0.9,uv.y);
  vec3 col;float al;
  float glow=0.11*exp(-max(alt,0.)/0.05)+0.045*exp(-max(alt,0.)/0.22);
  vec3 warm=vec3(1.,0.6,0.32);
  if(alt>0.){
    col=mix(vec3(0.045,0.05,0.085),vec3(0.012,0.016,0.035),smoothstep(0.,0.55,alt))+warm*glow;
    float mask=smoothstep(0.02,0.18,alt);
    vec3 s=dots(q,1./90.,floor(TAU/SPAN*90.),0.16,px/uDpr);
    float tw=0.72+0.28*sin(uT*(1.+3.*s.z)+s.z*40.);
    col+=vec3(0.82,0.87,1.)*s.x*(0.12+0.88*pow(s.y,4.))*tw*mask;
    vec3 s2=dots(q+0.37,1./23.,floor(TAU/SPAN*23.),0.09,px/uDpr*0.55);
    col+=vec3(1.,0.95,0.86)*s2.x*s2.y*0.9*mask*(0.85+0.15*sin(uT*2.+s2.z*30.));
    vec2 m=vec2(uMoon/SPAN,0.105);
    vec2 dm=(q-m)*vec2(1.,1.);
    float dmx=wrapA(dm.x*SPAN)/SPAN;dm.x=dmx;
    float R=0.0092;
    float disc=smoothstep(R,R-1.5/px,length(dm));
    float bite=smoothstep(R*1.02,R*1.02-1.5/px,length(dm-vec2(-0.0062,0.0018)));
    col+=vec3(0.96,0.92,0.84)*disc*(1.-bite)*0.95+vec3(0.5,0.55,0.7)*disc*bite*0.05;
    col+=vec3(0.6,0.62,0.7)*0.05*exp(-length(dm)/0.035);
    al=1.;
  }else{
    col=vec3(0.03,0.032,0.048)+warm*0.03*exp(alt/0.03);
    vec3 c=dots(q,1./260.,floor(TAU/SPAN*260.),0.42*exp(alt/0.03),px/uDpr*0.9);
    col+=mix(vec3(1.,0.7,0.4),vec3(0.95,0.9,0.8),step(0.7,c.z))*c.x*(0.25+0.75*c.y)*0.55*(0.8+0.2*sin(uT*0.7+c.z*50.));
    al=exp(alt/0.06);
  }
  float rr=range(a),hh=hills(a);
  if(alt<rr&&alt>-0.002){
    float haze=smoothstep(0.,rr,alt);
    col=mix(vec3(0.028,0.031,0.05),vec3(0.05,0.05,0.075),haze*0.55)+warm*0.012;al=1.;
  }
  if(alt<hh&&alt>-0.002){col=vec3(0.016,0.017,0.027);al=1.;}
  al*=edge;
  gl_FragColor=vec4(col*al,al);
}`;

export class Sky {
  private gl: WebGLRenderingContext | null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private az = 0;
  private hy = 0.8;
  private dirty = true;
  private lastDraw = -1e9;
  private ro: ResizeObserver;
  private dpr: number;

  constructor(
    private cv: HTMLCanvasElement,
    private reduce: boolean,
  ) {
    const phone = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.dpr = Math.min(phone ? 1.25 : 1.75, window.devicePixelRatio || 1);
    this.gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
    const gl = this.gl;
    if (gl) {
      const sh = (t: number, src: string) => {
        const s = gl.createShader(t)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const pr = gl.createProgram()!;
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) this.gl = null;
      else {
        gl.useProgram(pr);
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(pr, "p");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        for (const n of ["uRes", "uAz", "uHy", "uT", "uDpr", "uMoon"]) this.u[n] = gl.getUniformLocation(pr, n);
        gl.clearColor(0, 0, 0, 0);
      }
    }
    this.ro = new ResizeObserver(() => this.size());
    this.ro.observe(cv);
    this.size();
  }

  private size() {
    const w = Math.max(1, Math.round(this.cv.clientWidth * this.dpr)), h = Math.max(1, Math.round(this.cv.clientHeight * this.dpr));
    if (w === this.cv.width && h === this.cv.height) return;
    this.cv.width = w;
    this.cv.height = h;
    this.dirty = true;
  }

  /**
   * Where the camera looks. `turn` is how far it has turned from the default view (radians; the west is straight
   * ahead at 0), `elev` its height above the horizon (radians). The horizon sits high in the frame at the default
   * three-quarter view, lower as the camera comes down, and leaves the frame as it looks straight down.
   */
  view(turn: number, elev: number) {
    const hy = 0.8 + (elev - (35 * Math.PI) / 180) * 0.74;
    if (Math.abs(turn - this.az) < 1e-5 && Math.abs(hy - this.hy) < 1e-5) return;
    this.az = turn;
    this.hy = hy;
    this.dirty = true;
  }

  /** Draw if the view moved, or (motion allowed) about 24 times a second for the twinkle. */
  frame(now: number) {
    const gl = this.gl;
    if (!gl) return;
    if (!this.dirty && (this.reduce || now - this.lastDraw < 42)) return;
    if (this.hy > 1.3) {
      // Looking almost straight down: no sky in the frame.
      if (this.dirty) gl.clear(gl.COLOR_BUFFER_BIT);
      this.dirty = false;
      return;
    }
    this.lastDraw = now;
    this.dirty = false;
    gl.viewport(0, 0, this.cv.width, this.cv.height);
    gl.uniform2f(this.u.uRes!, this.cv.width, this.cv.height);
    gl.uniform1f(this.u.uAz!, this.az);
    gl.uniform1f(this.u.uHy!, this.hy);
    gl.uniform1f(this.u.uT!, this.reduce ? 1.7 : now / 1000);
    gl.uniform1f(this.u.uDpr!, this.dpr);
    // The moon hangs about two thirds across the default view, whatever the screen's shape.
    gl.uniform1f(this.u.uMoon!, -0.18 * (this.cv.width / this.cv.height) * 0.9);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.ro.disconnect();
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
