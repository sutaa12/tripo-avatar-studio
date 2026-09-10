import * as T from "three";
import { VRM, VRMSpringBoneManager, VRMSpringBoneJoint, VRMSpringBoneCollider,
  VRMSpringBoneColliderShapeSphere, VRMSpringBoneColliderShapePlane } from "@pixiv/three-vrm";

type Chain = { name: string; points: number[][]; stiffness: number; region: "front" | "side" | "back" | "tail";
  side: number; bones: T.Bone[]; indices: number[] };
const smooth = T.MathUtils.smoothstep;
const fall = (y: number, root: number, tip: number) => 1-smooth(y, tip, root);

export class HairMotion {
  strength = .65;
  readonly manager = new VRMSpringBoneManager();
  readonly chains: Chain[] = [];
  readonly stats = { vertices: 0, fixedVertices: 0, maxWeightError: 0, restError: 0 };
  private head?: T.Object3D;
  private accumulator = 0;
  private lastTime = 0;
  private previousPosition = new T.Vector3();
  private previousRotation = new T.Quaternion();
  private position = new T.Vector3();
  private rotation = new T.Quaternion();

  apply(vrm: VRM) {
    if (this.head) return;
    const mesh = vrm.scene.getObjectByName("Hair_Spike") as T.SkinnedMesh;
    const head = vrm.humanoid.getRawBoneNode("head");
    if (!mesh?.isSkinnedMesh || !head) return;
    this.head = head;
    vrm.scene.updateMatrixWorld(true);
    const geometry = mesh.geometry.clone();
    const p = geometry.getAttribute("position");
    const original = mesh.skeleton, headIndex = original.bones.indexOf(head as T.Bone);
    const oldWeights = geometry.getAttribute("skinWeight"), oldIndices = geometry.getAttribute("skinIndex");
    // This adapter is for the supplied rigid head-bound hair, not arbitrary already-rigged hair.
    for (let i=0; i<p.count; i++) if (oldIndices.getX(i)!==headIndex || oldWeights.getX(i)<.999)
      throw new Error("髪の骨構成が変わったため、揺れの設定を確認してください。");
    const toHead = (xyz: number[]) => head.worldToLocal(mesh.localToWorld(new T.Vector3(...xyz as [number,number,number])));
    const add = (name: string, region: Chain["region"], side: number, points: number[][], stiffness: number) => {
      const local = points.map(toHead), bones = local.map(() => new T.Bone());
      bones.forEach((b,i) => {
        b.name = `StudioHair_${name}_${i}`;
        b.position.copy(i ? local[i].clone().sub(local[i-1]) : local[i]);
        (i ? bones[i-1] : head).add(b);
      });
      this.chains.push({name,region,side,points,stiffness,bones,indices:[]});
    };
    add("bang_center","front",0,[[0,1.54,.115],[0,1.425,.157],[0,1.315,.154]],.7);
    for (const s of [-1,1]) {
      add(`bang_${s}`,"front",s,[[s*.074,1.53,.105],[s*.075,1.42,.15],[s*.079,1.315,.15]],.65);
      add(`lock_${s}`,"side",s,[[s*.125,1.49,.085],[s*.137,1.32,.118],[s*.142,1.16,.113]],.5);
      add(`tail_${s}`,"tail",s,[[s*.18,1.47,-.015],[s*.199,1.245,-.035],[s*.185,1.04,-.015]],.25);
    }
    add("back","back",0,[[0,1.53,-.10],[0,1.425,-.156],[0,1.315,-.14]],.65);
    vrm.scene.updateMatrixWorld(true);
    const bones = original.bones.slice(), inverses = original.boneInverses.map(m=>m.clone());
    for (const c of this.chains) for (const b of c.bones.slice(0,2)) {
      c.indices.push(bones.length); bones.push(b); inverses.push(b.matrixWorld.clone().invert());
    }
    const weights = new Float32Array(p.count*4), indices = new Uint16Array(p.count*4);
    for (let i=0; i<p.count; i++) {
      const x=p.getX(i), y=p.getY(i), z=p.getZ(i), ax=Math.abs(x);
      const front = smooth(z,.025,.09)*(1-smooth(ax,.09,.13))*fall(y,1.535,1.32)*smooth(y,1.27,1.32);
      const center = 1-smooth(ax,.025,.07);
      const side = smooth(ax,.075,.125)*(1-smooth(ax,.14,.18))*smooth(z,.015,.08)*fall(y,1.49,1.19);
      // Low curls bend inward; keep them with their tail instead of the short back-of-head chain.
      const low = 1-smooth(y,1.24,1.32);
      const tail = (smooth(ax,.135,.185)*(1-low)+smooth(ax,.07,.12)*low)*fall(y,1.49,1.1)*(1-side);
      const back = (1-smooth(z,-.1,-.025))*(1-smooth(ax,.12,.18))*fall(y,1.53,1.32)*smooth(y,1.27,1.32);
      const influences: [number,number][] = [];
      let total = 0;
      for (const c of this.chains) {
        if (c.side && Math.sign(x)!==c.side) continue;
        const w = c.region === "front" ? front*(c.side ? 1-center : center)
          : c.region === "side" ? side : c.region === "tail" ? tail : back;
        if (w < .00001) continue;
        const bend = fall(y,c.points[1][1]+.035,c.points[2][1]);
        influences.push([c.indices[0],w*(1-bend)],[c.indices[1],w*bend]); total+=w;
      }
      influences.push([headIndex,Math.max(0,1-total)]);
      influences.sort((a,b)=>b[1]-a[1]);
      const kept = influences.slice(0,4), sum=kept.reduce((s,v)=>s+v[1],0);
      for (let j=0; j<kept.length; j++) {indices[i*4+j]=kept[j][0]; weights[i*4+j]=kept[j][1]/sum;}
      if (total < .00001) this.stats.fixedVertices++;
      this.stats.maxWeightError=Math.max(this.stats.maxWeightError,Math.abs(weights.slice(i*4,i*4+4).reduce((a,b)=>a+b,0)-1));
    }
    geometry.setAttribute("skinIndex",new T.BufferAttribute(indices,4));
    geometry.setAttribute("skinWeight",new T.BufferAttribute(weights,4));
    mesh.geometry=geometry;
    mesh.bind(new T.Skeleton(bones,inverses),mesh.bindMatrix.clone());
    mesh.skeleton.update();
    const rest = new T.Vector3(), actual = new T.Vector3();
    for (let i=0; i<p.count; i++) {
      rest.fromBufferAttribute(p,i); actual.copy(rest); mesh.applyBoneTransform(i,actual);
      this.stats.restError=Math.max(this.stats.restError,rest.distanceTo(actual));
    }
    this.stats.vertices=p.count;
    const sphere = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({offset:toHead([0,1.425,0]),radius:.123}));
    head.add(sphere);
    for (const c of this.chains) {
      const normal = c.region === "back" ? new T.Vector3(0,0,-1)
        : c.region === "tail" ? new T.Vector3(c.side,0,0) : new T.Vector3(0,0,1);
      const point = c.region === "back" ? [0,1.4,-.108]
        : c.region === "tail" ? [c.side*.14,1.3,0] : [0,1.4,.105];
      const plane = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapePlane({normal,offset:toHead(point)}));
      head.add(plane);
      for (let i=0;i<2;i++) {
        // A head-relative envelope limits fast turns without altering the solver's hidden velocity state.
        const limit = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({
          offset:toHead(c.points[i+1]),radius:c.region === "tail" ? .058 : c.region === "side" ? .026 : .020,inside:true,
        }));
        head.add(limit);
        this.manager.addJoint(new VRMSpringBoneJoint(c.bones[i],c.bones[i+1],{
          stiffness:c.stiffness,dragForce:.42,gravityPower:0,hitRadius:.004,
        },[{colliders:[sphere,plane,limit]}]));
      }
    }
    this.manager.setInitState();
    this.reset();
  }
  reset() {
    this.manager.reset(); this.accumulator=0;
    this.head?.getWorldPosition(this.previousPosition);
    this.head?.getWorldQuaternion(this.previousRotation);
  }
  update(dt: number) {
    if (!this.head) return;
    const now=performance.now();
    this.head.getWorldPosition(this.position); this.head.getWorldQuaternion(this.rotation);
    const jump=this.position.distanceToSquared(this.previousPosition)>.09
      || this.rotation.angleTo(this.previousRotation)>.85;
    if (this.strength<=.001 || dt>.15 || now-this.lastTime>250 || jump) this.reset();
    else {
      this.accumulator+=Math.max(0,Math.min(dt,.05));
      for (const c of this.chains) for (const joint of this.manager.joints) if (c.bones.includes(joint.bone as T.Bone)) {
        joint.settings.stiffness=c.stiffness/(.3+this.strength);
        joint.settings.dragForce=.32-this.strength*.18;
      }
      while (this.accumulator>=1/90) {this.manager.update(1/90); this.accumulator-=1/90;}
    }
    this.lastTime=now;
    this.previousPosition.copy(this.position); this.previousRotation.copy(this.rotation);
  }
}
