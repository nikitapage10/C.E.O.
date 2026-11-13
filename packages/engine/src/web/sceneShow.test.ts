import { describe, expect, it } from "vitest";
import { Camera, Group, Mesh, PointLight } from "three";
import { isShown, showParts } from "./sceneShow.ts";

describe("showParts", () => {
  const rig = () => {
    const g = new Group();
    const m = new Mesh();
    const l = new PointLight(0xffffff, 7);
    g.add(m, l);
    return { g, m, l };
  };

  it("hides meshes by layer and dims lights, keeping the group and its lights in the frame", () => {
    const { g, m, l } = rig();
    const cam = new Camera();
    showParts(g, false);
    expect(isShown(g)).toBe(false);
    expect(g.visible).toBe(true);
    expect(l.visible).toBe(true);
    expect(l.layers.test(cam.layers)).toBe(true);
    expect(l.intensity).toBe(0);
    expect(m.layers.test(cam.layers)).toBe(false);
  });

  it("restores what it hid, and repeated calls change nothing", () => {
    const { g, m, l } = rig();
    m.layers.enable(3);
    const mask = m.layers.mask;
    showParts(g, false);
    showParts(g, false);
    showParts(g, true);
    showParts(g, true);
    expect(isShown(g)).toBe(true);
    expect(l.intensity).toBe(7);
    expect(m.layers.mask).toBe(mask);
  });
});
