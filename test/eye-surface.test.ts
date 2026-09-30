import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { repairEyeSurfaces } from "../src/eye-surface";

test("eye repair preserves geometry, bone binding and independent lids", () => {
  const root = new T.Group();
  const eyes = ["Left", "Right"].map((side, index) => {
    const geometry = new T.BoxGeometry(.077, .065, .046);
    geometry.translate(index ? -.0598 : .0598, 1.3611, .0816);
    const eye = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
    eye.name = "Eye_" + side;
    const bone = new T.Bone();
    eye.add(bone);eye.bind(new T.Skeleton([bone]));root.add(eye);
    return eye;
  });
  const lid = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  lid.name = "Head_Face_Loops";root.add(lid);
  const before = eyes.map(e => ({ geometry:e.geometry, positions:Array.from(e.geometry.attributes.position.array), skeleton:e.skeleton, binding:e.bindMatrix.clone() }));
  const lidMaterial = lid.material;
  assert.equal(repairEyeSurfaces(root).eyes, 2);
  eyes.forEach((eye,i) => {
    assert.equal(eye.geometry,before[i].geometry);
    assert.deepEqual(Array.from(eye.geometry.attributes.position.array),before[i].positions);
    assert.equal(eye.skeleton,before[i].skeleton);
    assert.ok(eye.bindMatrix.equals(before[i].binding));
    assert.equal(eye.material.depthTest,true);
    assert.equal(eye.material.depthWrite,true);
  });
  assert.equal(lid.material,lidMaterial);
  const materials=eyes.map(e=>e.material);
  assert.equal(repairEyeSurfaces(root).eyes,0);
  assert.equal(eyes[0].material,materials[0]);
  assert.equal(eyes[1].material,materials[1]);
});

test("unrelated meshes and invalid eye bounds retain their original materials", () => {
  const root = new T.Group();
  const unrelated = new T.SkinnedMesh(new T.BoxGeometry(),new T.MeshBasicMaterial());
  unrelated.name="Hair_Spike";
  const invalid = new T.SkinnedMesh(new T.BufferGeometry(),new T.MeshBasicMaterial());
  invalid.name="Eye_Left";
  invalid.geometry.setAttribute("position",new T.Float32BufferAttribute([0,0,0],3));
  root.add(unrelated,invalid);
  const materials=[unrelated.material,invalid.material];
  assert.equal(repairEyeSurfaces(root).eyes,0);
  assert.equal(unrelated.material,materials[0]);assert.equal(invalid.material,materials[1]);
});
