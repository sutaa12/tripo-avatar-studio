import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { trackingWeight } from "./layout";
import { TrackingState, trackingDirection } from "./tracking-state";
import { ToonStyle } from "./toon";
import { BlinkCorrection, smoothBlink, lashArcWeight } from "./blink";
import { mouthTargets } from "./mouth";
export class Avatar {
  blink = new BlinkCorrection();
  toon = new ToonStyle();
  neutralFace = new T.Quaternion();
  neutralBody = new T.Vector3();
  renderer = new T.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(28, 1, 0.01, 20);
  vrm?: VRM;
  debug = {
    blinkLeft: 0,
    blinkRight: 0,
    jawOpen: 0,
    mouthNarrow: 0,
    arm: 0,
    fingers: 0,
    turn: 0,
    seated: true,
  };
  demoActive = false;
  private demoTime = 0;
  setDemo(active: boolean) {
    this.demoActive = active;
    this.demoTime = 0;
    if (active) this.tracking = new TrackingState();
  }
  tracking = new TrackingState();
  packet: any;
  received = -Infinity;
  previous = new Map<string, T.Quaternion>();
  restDirections = new Map<string, T.Vector3>();
  restPalms = new Map<string, T.Quaternion>();
  curlAxes = new Map<string, T.Vector3>();
  faceValues: Record<string, number> = {};
  stats = { bones: 0, expressions: [] as string[], triangles: 0 };
  constructor() {
    this.renderer.setSize(900, 1080);
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.camera.aspect = 900 / 1080;
    this.camera.position.set(0, 1.2, 2.8);
    this.camera.lookAt(0, 1.04, 0);
    this.camera.updateProjectionMatrix();
    this.scene.add(new T.HemisphereLight(0xffffff, 0xd7bfd4, 2));
    const l = new T.DirectionalLight(0xfff6ee, 2);
    l.position.set(-1, 2, 3);
    this.scene.add(l);
  }
  async load() {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    const g = await loader.loadAsync(new URL("models/avatar.gltf", document.baseURI).href);
    this.vrm = g.userData.vrm;
    this.scene.add(this.vrm!.scene);
    this.toon.apply(this.vrm!.scene, this.renderer);
    if (this.vrm!.lookAt) this.vrm!.lookAt.autoUpdate = false;
    for (const side of ["left", "right"]) {
      for (const [part, child] of [
        ["UpperArm", "LowerArm"],
        ["LowerArm", "Hand"],
      ]) {
        this.restDirections.set(
          side + part,
          this.bone(side + child)!
            .position.clone()
            .normalize(),
        );
      }
      const hand = this.bone(side + "Hand")!;
      const origin = hand.getWorldPosition(new T.Vector3());
      const index = this.bone(side + "IndexProximal")!.getWorldPosition(
        new T.Vector3(),
      );
      const middle = this.bone(side + "MiddleProximal")!.getWorldPosition(
        new T.Vector3(),
      );
      const little = this.bone(side + "LittleProximal")!.getWorldPosition(
        new T.Vector3(),
      );
      const along = middle.sub(origin).normalize();
      const across = little.sub(index).normalize();
      this.restPalms.set(side, this.palmFrame(along, across));
      this.curlAxes.set(side, across);
      for (const finger of ["Thumb", "Index", "Middle", "Ring", "Little"]) {
        const segments =
          finger === "Thumb"
            ? ["Metacarpal", "Proximal", "Distal"]
            : ["Proximal", "Intermediate", "Distal"];
        for (let i = 0; i < 3; i++) {
          const child = this.bone(
            side + finger + segments[Math.min(i + 1, 2)],
          )!;
          this.restDirections.set(
            side + finger + segments[i],
            child.position.clone().normalize(),
          );
        }
      }
    }
    this.stats.bones = Object.keys(this.vrm!.humanoid.humanBones).length;
    this.stats.expressions = this.vrm!.expressionManager!.expressions.map(
      (e) => e.expressionName,
    );
    this.scene.traverse((o) => {
      const m = o as T.Mesh;
      if ((m as T.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
      if (m.isMesh)
        this.stats.triangles +=
          (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
    });
  }
  bone(n: string) {
    return this.vrm?.humanoid.getNormalizedBoneNode(n as VRMHumanBoneName);
  }
  rot(n: string, x = 0, y = 0, z = 0) {
    this.bone(n)?.quaternion.setFromEuler(new T.Euler(x, y, z));
  }
  calibrate() {
    const weights = this.tracking.weights(performance.now()),
      m = this.tracking.face?.facialTransformationMatrixes?.[0]?.data;
    if (weights.face > 0.5 && m)
      new T.Matrix4()
        .fromArray(m)
        .decompose(new T.Vector3(), this.neutralFace, new T.Vector3());
    const ps = this.tracking.pose?.worldLandmarks?.[0];
    if (weights.pose > 0.5 && ps) this.neutralBody.copy(this.bodyAngles(ps));
    return weights.face > 0.5 || weights.pose > 0.5;
  }
  bodyAngles(ps: any[]) {
    const dx = Math.abs(ps[12].x - ps[11].x),
      roll = Math.atan2(ps[11].y - ps[12].y, dx),
      yaw = Math.atan2(ps[11].z - ps[12].z, dx);
    let pitch = 0;
    const l = this.tracking.pose?.landmarks?.[0];
    if (l?.[23]?.visibility > 0.5 && l?.[24]?.visibility > 0.5) {
      const dy = (ps[23].y + ps[24].y - ps[11].y - ps[12].y) / 2,
        dz = (ps[11].z + ps[12].z - ps[23].z - ps[24].z) / 2;
      pitch = -Math.atan2(dz, Math.max(0.1, dy));
    }
    return new T.Vector3(pitch, yaw, roll);
  }
  receive(p: any) {
    this.packet = p;
    this.received = performance.now();
    this.tracking.ingest(p, this.received);
    this.blink.observe(p.face, this.received);
  }
  palmFrame(along: T.Vector3, across: T.Vector3) {
    const x = along.clone().normalize();
    const z = x.clone().cross(across).normalize();
    const y = z.clone().cross(x).normalize();
    return new T.Quaternion().setFromRotationMatrix(
      new T.Matrix4().makeBasis(x, y, z),
    );
  }
  aimDirection(name: string, direction: T.Vector3, weight: number) {
    const bone = this.bone(name);
    const rest = this.restDirections.get(name);
    if (!bone || !rest || direction.lengthSq() < 1e-8) return;
    const world = new T.Quaternion().setFromUnitVectors(
      rest,
      direction.normalize(),
    );
    const parent = bone.parent!.getWorldQuaternion(new T.Quaternion()).invert();
    bone.quaternion.slerp(parent.multiply(world), weight);
    this.vrm!.scene.updateMatrixWorld(true);
  }
  aim(name: string, a: any, b: any, w: number) {
    const bone = this.bone(name);
    if (
      !bone ||
      !a ||
      !b ||
      (a.visibility ?? 1) < 0.5 ||
      (b.visibility ?? 1) < 0.5
    )
      return;
    const delta = trackingDirection(a, b);
    const d = new T.Vector3(delta.x, delta.y, delta.z).normalize();
    if (d.lengthSq() < 0.1) return;
    this.aimDirection(name, d, w);
  }
  aimFinger(name: string, a: any, b: any, weight: number) {
    const bone = this.bone(name),
      rest = this.restDirections.get(name);
    if (!bone || !rest) return;
    const delta = trackingDirection(a, b);
    const direction = new T.Vector3(delta.x, delta.y, delta.z);
    if (direction.lengthSq() < 1e-8) return;
    const parent = bone.parent!.getWorldQuaternion(new T.Quaternion());
    const current = rest.clone().applyQuaternion(parent);
    const swing = new T.Quaternion().setFromUnitVectors(
      current,
      direction.normalize(),
    );
    const local = parent.clone().invert().multiply(swing).multiply(parent);
    bone.quaternion.slerp(local, weight);
    this.vrm!.scene.updateMatrixWorld(true);
  }
  update(dt: number) {
    if (!this.vrm) return;
    const v = this.vrm;
    this.demoTime += this.demoActive ? dt : 0;
    const demo = this.demoActive;
    const time = this.demoTime;
    v.humanoid.resetNormalizedPose();
    if (this.debug.seated) {
      this.rot("leftUpperLeg", -1.35);
      this.rot("rightUpperLeg", -1.35);
      this.rot("leftLowerLeg", 1.4);
      this.rot("rightLowerLeg", 1.4);
    }
    v.scene.updateMatrixWorld(true);
    for (const [side, sign] of [
      ["left", 1],
      ["right", -1],
    ] as const) {
      const phase = time * 1.3 + (side === "left" ? 0 : Math.PI);
      const angle = -1.1 + (demo ? .85 + .7 * Math.sin(phase) : this.debug.arm);
      this.aimDirection(
        side + "UpperArm",
        new T.Vector3(sign * Math.cos(angle), Math.sin(angle), 0),
        1,
      );
      this.aimDirection(
        side + "LowerArm",
        new T.Vector3(sign * Math.cos(angle + (demo ? .35 : 0)) * 0.97, Math.sin(angle + (demo ? .35 : 0)), 0.25),
        1,
      );
    }
    for (const side of ["left", "right"])
      for (const finger of ["Thumb", "Index", "Middle", "Ring", "Little"])
        for (const seg of finger === "Thumb"
          ? ["Metacarpal", "Proximal", "Distal"]
          : ["Proximal", "Intermediate", "Distal"])
          this.bone(side + finger + seg)?.quaternion.setFromAxisAngle(
            this.curlAxes.get(side)!,
            (side === "left" ? 1 : -1) *
              (demo ? .5 + .5 * Math.sin(time * 2.1) : this.debug.fingers) *
              (finger === "Thumb" ? 0.65 : 1.1),
          );
    this.rot("head", demo ? .24 * Math.sin(time * .9) : 0,
      demo ? .58 * Math.sin(time * .7) : this.debug.turn,
      demo ? .16 * Math.sin(time * 1.1) : 0);
    if (demo) {
      this.rot("neck", .06 * Math.sin(time * .9), .10 * Math.sin(time * .7));
      this.rot("chest", .15 * Math.sin(time * .8), .18 * Math.sin(time * .5), .10 * Math.sin(time));
    }
    const now = performance.now(),
      weights = this.tracking.weights(now),
      w = weights.face;
    const p = {
      face: this.tracking.face ?? {},
      pose: this.tracking.pose ?? {},
    };
    const values = {
      blinkLeft: demo ? Math.pow(Math.max(0, Math.cos(time * Math.PI / 2)), 16) : this.debug.blinkLeft,
      blinkRight: demo ? Math.pow(Math.max(0, Math.cos(time * Math.PI / 2)), 16) : this.debug.blinkRight,
      jawOpen: demo ? .08 + .82 * Math.pow(.5 + .5 * Math.sin(time * 3.6), 2) : this.debug.jawOpen,
      mouthNarrow: demo ? .85 * Math.pow(Math.max(0, Math.sin(time * 1.8)), 2) : this.debug.mouthNarrow,
    };
    if (true) {
      const c: Record<string, number> = {};
      for (const x of p.face.faceBlendshapes?.[0]?.categories ?? [])
        c[x.categoryName] = x.score;
      // Hold the last blink until face tracking expires. A fading pose weight
      // must not turn a fully closed eye back into a half-open eye between packets.
      const blinkWeight = w > 0 ? 1 : 0;
      values.blinkLeft += this.blink.map(c.eyeBlinkLeft ?? 0, "Left") * blinkWeight;
      values.blinkRight += this.blink.map(c.eyeBlinkRight ?? 0, "Right") * blinkWeight;
      const mouth = mouthTargets(c);
      values.jawOpen += mouth.jawOpen * w;
      values.mouthNarrow += mouth.mouthNarrow * w;
      const m = p.face.facialTransformationMatrixes?.[0]?.data;
      if (m) {
        const mat = new T.Matrix4().fromArray(m);
        const q = new T.Quaternion();
        mat.decompose(new T.Vector3(), q, new T.Vector3());
        q.normalize().premultiply(this.neutralFace.clone().invert());
        const e = new T.Euler().setFromQuaternion(q, "YXZ");
        this.rot(
          "head",
          T.MathUtils.clamp(e.x, -0.5, 0.5) * w,
          T.MathUtils.clamp(-e.y, -0.7, 0.7) * w,
          T.MathUtils.clamp(-e.z, -0.4, 0.4) * w,
        );
      }
      for (const side of ["Left", "Right"]) {
        const horizontal =
          (c["eyeLookOut" + side] ?? 0) - (c["eyeLookIn" + side] ?? 0);
        const vertical =
          (c["eyeLookDown" + side] ?? 0) - (c["eyeLookUp" + side] ?? 0);
        this.rot(
          side.toLowerCase() + "Eye",
          demo ? .16 * Math.sin(time * 1.5) : vertical * 0.3 * w,
          demo ? .20 * Math.sin(time * 1.2) : horizontal * (side === "Left" ? 1 : -1) * 0.3 * w,
        );
      }
      const ps = p.pose.worldLandmarks?.[0];
      if (ps && weights.pose > 0) {
        const w = weights.pose;
        const angles = this.bodyAngles(ps).sub(this.neutralBody);
        this.rot(
          "chest",
          T.MathUtils.clamp(angles.x, -0.3, 0.3) * w,
          T.MathUtils.clamp(angles.y, -0.45, 0.45) * w,
          T.MathUtils.clamp(angles.z, -0.25, 0.25) * w,
        );
        v.scene.updateMatrixWorld(true);
        for (const [side, s, e, h] of [
          ["left", 11, 13, 15],
          ["right", 12, 14, 16],
        ] as const) {
          this.rot(
            side + "Shoulder",
            0,
            0,
            T.MathUtils.clamp(
              ((ps[11].y + ps[12].y) / 2 - ps[s].y) * 2,
              -0.2,
              0.2,
            ) * w,
          );
          this.aim(side + "UpperArm", ps[s], ps[e], w);
          this.aim(side + "LowerArm", ps[e], ps[h], w);
        }
      }
      for (const [side, entry] of this.tracking.hands) {
        const h = entry.data,
          w = trackingWeight(now - entry.at);
        if (w <= 0) continue;
        const along = trackingDirection(h[0], h[9]);
        const across = trackingDirection(h[5], h[17]);
        const direction = new T.Vector3(along.x, along.y, along.z);
        const breadth = new T.Vector3(across.x, across.y, across.z);
        if (direction.clone().cross(breadth).lengthSq() > 1e-10) {
          const frame = this.palmFrame(direction, breadth).multiply(
            this.restPalms.get(side)!.clone().invert(),
          );
          const hand = this.bone(side + "Hand")!;
          const parent = hand
            .parent!.getWorldQuaternion(new T.Quaternion())
            .invert();
          hand.quaternion.slerp(parent.multiply(frame), w);
          v.scene.updateMatrixWorld(true);
        }
        for (const [finger, start] of [
          ["Thumb", 1],
          ["Index", 5],
          ["Middle", 9],
          ["Ring", 13],
          ["Little", 17],
        ] as const) {
          for (let j = 0; j < 3; j++) {
            const at = h[start + j],
              next = h[start + j + 1];
            const name =
              side +
              finger +
              (finger === "Thumb"
                ? ["Metacarpal", "Proximal", "Distal"]
                : ["Proximal", "Intermediate", "Distal"])[j];
            this.aimFinger(name, at, next, w);
          }
        }
      }
    }
    if (weights.face > 0) {
      const head = this.bone("head")!;
      head.quaternion.premultiply(
        head.parent!.getWorldQuaternion(new T.Quaternion()).invert(),
      );
    }
    const alpha = 1 - Math.exp(-dt * 18);
    if (v.expressionManager?.getExpression("pose_seated")) {
      v.expressionManager.setValue("pose_seated", this.debug.seated ? 1 : 0);
    }
    for (const name of Object.keys(v.humanoid.humanBones)) {
      const b = this.bone(name);
      if (!b) continue;
      const old = this.previous.get(name);
      if (old) b.quaternion.copy(old.clone().slerp(b.quaternion, alpha));
      this.previous.set(name, b.quaternion.clone());
    }
    for (const [name, value] of Object.entries(values)) {
      const smoothed = name.startsWith("blink")
        ? smoothBlink(this.faceValues[name] ?? 0, value, dt)
        :
        (this.faceValues[name] ?? 0) +
        (T.MathUtils.clamp(value, 0, 1) - (this.faceValues[name] ?? 0)) * alpha;
      this.faceValues[name] = smoothed;
      v.expressionManager?.setValue("track_" + name, smoothed);
      if (name === "blinkLeft" || name === "blinkRight") {
        const expression = "correct_lash" + name.slice(5);
        if (v.expressionManager?.getExpression(expression))
          v.expressionManager.setValue(expression, lashArcWeight(smoothed));
      }
    }
    v.update(dt);
    this.toon.update(
      v.humanoid.getRawBoneNode("head") ?? undefined,
      this.camera,
    );
    this.renderer.render(this.scene, this.camera);
  }
}
