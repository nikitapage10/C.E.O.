import { BufferGeometry, Group, Mesh, MeshBasicMaterial, Scene, type Camera, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { describe, expect, it } from "vitest";
import { leanAO, transparencySets, type AOPass } from "./leanAO.ts";

const mat = (o: { transparent?: boolean; depthWrite?: boolean }) => new MeshBasicMaterial(o);

/** A renderer that records, for each scene draw, which meshes were visible and how matrices and shadows were set. */
function fakeRenderer(scene: Scene) {
  const draws: { target: unknown; visible: string[]; autoMatrix: boolean; shadows: boolean }[] = [];
  let target: unknown = null;
  const renderer = {
    shadowMap: { autoUpdate: true },
    autoClearDepth: true,
    getClearColor: (c: { set: (v: number) => void }) => (c.set(0x123456), c),
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    setRenderTarget: (t: unknown) => (target = t),
    clear: () => undefined,
    render(s: Scene) {
      if (s !== scene) return;
      const visible: string[] = [];
      scene.traverseVisible((o) => o.name && visible.push(o.name));
      draws.push({ target, visible, autoMatrix: scene.matrixWorldAutoUpdate, shadows: renderer.shadowMap.autoUpdate });
    },
  };
  return { renderer: renderer as unknown as WebGLRenderer & typeof renderer, draws };
}

function fakePass(scene: Scene): AOPass & { originalCalls: number } {
  const pass = {
    scene,
    camera: {} as Camera,
    autoDetectTransparency: true,
    configuration: { transparencyAware: false, depthBufferType: 1 },
    depthTexture: "depth",
    transparencyRenderTargetDWFalse: { name: "dwFalse" } as unknown as WebGLRenderTarget,
    transparencyRenderTargetDWTrue: { name: "dwTrue" } as unknown as WebGLRenderTarget,
    depthCopyPass: { material: { uniforms: { depthTexture: { value: null }, reverseDepthBuffer: { value: true } } }, render: () => undefined },
    originalCalls: 0,
    renderTransparency() {
      pass.originalCalls++;
    },
  };
  return pass;
}

function world() {
  const scene = new Scene();
  const add = (name: string, m: MeshBasicMaterial, parent: Group | Scene = scene) => {
    const mesh = new Mesh(undefined, m);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };
  add("solid", mat({}));
  add("glass", mat({ transparent: true, depthWrite: false }));
  add("pane", mat({ transparent: true, depthWrite: true }));
  add("hidden-glass", mat({ transparent: true, depthWrite: false })).visible = false;
  add("opaque-glass", mat({ transparent: true, depthWrite: false })).userData.treatAsOpaque = true;
  add("no-ao", mat({})).userData.cannotReceiveAO = true;
  return scene;
}

describe("transparencySets", () => {
  it("matches n8ao's picks for both draws", () => {
    const scene = world();
    const objects = scene.children as Mesh<BufferGeometry, MeshBasicMaterial>[];
    const { noDepthWrite, depthWrite } = transparencySets(objects, objects.map((o) => o.visible));
    const names = (flags: boolean[]) => objects.filter((_, i) => flags[i]).map((o) => o.name);
    expect(names(noDepthWrite)).toEqual(["glass", "no-ao"]);
    expect(names(depthWrite)).toEqual(["pane"]);
  });
});

describe("leanAO", () => {
  it("draws the same two sets, reusing matrices and sparing both shadow passes, then restores everything", () => {
    const scene = world();
    const pass = fakePass(scene);
    const { renderer, draws } = fakeRenderer(scene);
    const undo = leanAO(pass);
    expect(pass.autoDetectTransparency).toBe(false);
    expect(pass.configuration.transparencyAware).toBe(true);

    const before = scene.children.map((o) => o.visible);
    pass.renderTransparency(renderer);

    expect(draws).toEqual([
      { target: pass.transparencyRenderTargetDWFalse, visible: ["glass", "no-ao"], autoMatrix: false, shadows: false },
      { target: pass.transparencyRenderTargetDWTrue, visible: ["pane"], autoMatrix: false, shadows: false },
    ]);
    expect(scene.children.map((o) => o.visible)).toEqual(before);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    expect(renderer.autoClearDepth).toBe(true);
    expect(pass.depthCopyPass!.material.uniforms.depthTexture.value).toBe("depth");
    expect(pass.depthCopyPass!.material.uniforms.reverseDepthBuffer.value).toBe(false);
    expect(pass.originalCalls).toBe(0);

    undo();
    expect(pass.autoDetectTransparency).toBe(true);
    pass.renderTransparency(renderer);
    expect(pass.originalCalls).toBe(1);
  });

  it("falls back to n8ao's own code when the pass doesn't look as expected", () => {
    const scene = world();
    const pass = fakePass(scene);
    pass.depthCopyPass = null;
    const { renderer, draws } = fakeRenderer(scene);
    leanAO(pass);
    pass.renderTransparency(renderer);
    expect(pass.originalCalls).toBe(1);
    expect(draws).toEqual([]);
  });
});
