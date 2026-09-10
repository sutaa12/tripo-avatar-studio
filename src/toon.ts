import * as T from "three";
import { MToonMaterial } from "@pixiv/three-vrm";
import { ToonOutline } from "./toon-outline";

/** Hair flow is a separate attribute so skinning also bends the highlight direction. */
function prepareFlow(g: T.BufferGeometry) {
  if (g.hasAttribute("avatarFlow")) return;
  const p = g.getAttribute("position"), flow = new Float32Array(p.count*3);
  const direction = new T.Vector3();
  for (let i=0; i<p.count; i++) {
    const curl = T.MathUtils.smoothstep(Math.abs(p.getX(i)),.13,.19)
      * (1-T.MathUtils.smoothstep(p.getY(i),1.12,1.35));
    const phase=(p.getY(i)-1)*43;
    direction.set(curl*Math.cos(phase)*.7,-1,curl*Math.sin(phase)*.7).normalize().toArray(flow,i*3);
  }
  g.setAttribute("avatarFlow",new T.BufferAttribute(flow,3));
}

export class ToonStyle {
  readonly outline = new ToonOutline();
  profile = { enabled: true, outlinePixels: 1.6, hairHighlight: .14, faceShadow: .12,
    shadowStrength: .65, clothingShadow: .6, rimStrength: .22 };
  outputScale = 1;
  private light = { value: new T.Vector3() };
  private faceLight = { value: new T.Vector3() };
  private faceForward = { value: new T.Vector3() };
  private style = { value: new T.Vector4() };
  private headRotation = new T.Quaternion();
  apply(root: T.Object3D, renderer: T.WebGLRenderer) {
    root.traverse(o => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh) return;
      prepareFlow(mesh.geometry);
      const transform = (original: T.Material) => {
        if (!(original as MToonMaterial).isMToonMaterial) return original;
        const mat = original.clone() as MToonMaterial;
        if (mat.isOutline) { mat.visible = false; return mat; }
        // A multi-material glTF mesh puts its primitives under the named head node.
        const headSurface = mesh.name.startsWith("Head_") || mesh.parent?.name === "Head_Face_Loops";
        const role = mesh.name.startsWith("Hair") ? 2
          : headSurface && !mesh.name.includes("Choker") && mat.name !== "Eyelash" ? 1
          : mat.name === "Garment_Clean_Color" || mesh.name.includes("Choker") ? 3
          : mat.name === "Hand_Skin" ? 4 : 0;
        mat.userData.role = role;
        const skin = role === 1 || role === 4;
        mat.shadeColorFactor.setRGB(...(skin ? [.83,.69,.66] : role === 2 ? [.65,.44,.53] : [.62,.48,.58]) as [number,number,number]);
        mat.shadingShiftFactor = skin ? .12 : .02;
        mat.shadingToonyFactor = skin ? .55 : .78;
        mat.giEqualizationFactor = .9;
        if (mat.map) mat.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        const prior = mat.onBeforeCompile.bind(mat), cache = mat.customProgramCacheKey.bind(mat);
        mat.customProgramCacheKey = () => cache()+":avatar-toon-v4:"+role;
        mat.onBeforeCompile = (shader) => {
          prior(shader, renderer);
          Object.assign(shader.uniforms, {avatarLight:this.light, avatarFaceLight:this.faceLight,
            avatarFaceForward:this.faceForward, avatarStyle:this.style, avatarRole:{value:role}});
          shader.vertexShader = `attribute vec3 avatarFlow;
varying vec3 avatarBind;
varying vec3 avatarStrand;
` + shader.vertexShader.replace("void main() {", "void main() {\n avatarBind = position;")
            .replace("#include <skinnormal_vertex>", `#include <skinnormal_vertex>
vec3 strandDirection = avatarFlow;
#ifdef USE_SKINNING
strandDirection = (skinMatrix * vec4(strandDirection,0.0)).xyz;
#endif
avatarStrand = normalize(normalMatrix * strandDirection);`);
          shader.fragmentShader = `varying vec3 avatarBind;
varying vec3 avatarStrand;
uniform vec3 avatarLight;
uniform vec3 avatarFaceLight;
uniform vec3 avatarFaceForward;
uniform vec4 avatarStyle;
uniform float avatarRole;
` + shader.fragmentShader
            .replace("material.shadeColor = shadeColorFactor;", `
// The imported materials have no shade map; keep black and pink albedo in shadow.
material.shadeColor = material.diffuseColor * mix(vec3(1.0),shadeColorFactor,avatarStyle.z);`)
            .replaceAll("float dotNL = clamp( dot( geometryNormal, directLight.direction ), -1.0, 1.0 );", `
float dotNL = clamp(dot(geometryNormal,directLight.direction),-1.0,1.0);
// Head-facing light keeps separately retopologized facial patches continuous.
// The smooth positional side shadow below supplies the broad face shading.
if (avatarRole == 1.0) dotNL = dot(avatarFaceForward,directLight.direction);`)
            .replace("getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )",
              "getHemisphereLightIrradiance( hemisphereLights[ i ], avatarRole == 1.0 ? avatarFaceForward : geometryNormal )")
            .replace("shading = linearstep( -1.0 + shadingToonyFactor, 1.0 - shadingToonyFactor, shading );", `
float softness = max(1.0-shadingToonyFactor,fwidth(shading)*1.5);
shading = smoothstep(-softness,softness,shading);`)
            .replace("col += totalEmissiveRadiance;", `col += totalEmissiveRadiance;
#ifndef OUTLINE
vec3 view = normalize(vViewPosition);
float ndl = dot(normal,avatarLight);
if (avatarRole == 2.0) {
  vec3 flow = normalize(avatarStrand-normal*dot(normal,avatarStrand)+vec3(0.0001));
  vec3 halfDirection = normalize(view+avatarLight);
  float alignment = dot(normalize(flow+normal*0.12),halfDirection);
  float strand = sqrt(max(0.0,1.0-alignment*alignment));
  float lobe = pow(strand,64.0);
  float edge = max(fwidth(lobe)*1.5,0.035);
  float band = smoothstep(0.40-edge,0.68+edge,lobe);
  float secondary = pow(strand,14.0)*0.15;
  float hairMask = smoothstep(0.08,0.4,dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722)));
  col += (diffuseColor.rgb*0.65+vec3(0.20,0.15,0.17))*avatarStyle.x
    *(band+secondary)*smoothstep(-0.15,0.45,ndl)*hairMask;
} else if (avatarRole == 1.0) {
  float side = avatarBind.x*sign(avatarFaceLight.x);
  float edge = max(fwidth(side)*2.0,0.018);
  float sideShadow = smoothstep(0.015-edge,0.095+edge,-side)*(1.0-clamp(avatarFaceLight.z,0.0,1.0));
  col *= mix(vec3(1.0),vec3(0.91,0.78,0.78),sideShadow*avatarStyle.z);
}
if (avatarRole == 2.0 || avatarRole == 3.0) {
  float rim = pow(1.0-clamp(dot(normal,view),0.0,1.0),3.4);
  float direction = smoothstep(-0.25,0.55,ndl);
  col += diffuseColor.rgb*vec3(0.42,0.32,0.40)*rim*direction*avatarStyle.y;
  float deepShade = 1.0-smoothstep(-0.65,-0.2,ndl);
  col *= mix(vec3(1.0),vec3(0.91,0.86,0.93),deepShade*avatarStyle.z);
}
if (avatarRole == 3.0) {
  // The body atlas also contains exposed skin. Its warm yellow undertone
  // excludes it from the extra violet cloth shadow, including chest and legs.
  float skinMask = smoothstep(0.012,0.065,diffuseColor.g-diffuseColor.b)
    * smoothstep(0.15,0.40,diffuseColor.r);
  float shadeEdge = max(fwidth(ndl)*2.0,0.12);
  float clothShade = 1.0-smoothstep(0.22-shadeEdge,0.22+shadeEdge,ndl);
  col *= mix(vec3(1.0),vec3(0.60,0.41,0.57),clothShade*avatarStyle.w*(1.0-skinMask));
}
#endif`);
        };
        return mat;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(transform) : transform(mesh.material);
    });
  }
  update(head: T.Object3D | undefined, camera: T.Camera) {
    camera.updateMatrixWorld();
    if (head) head.getWorldQuaternion(this.headRotation); else this.headRotation.identity();
    this.faceForward.value.set(0,0,1).applyQuaternion(this.headRotation).transformDirection(camera.matrixWorldInverse);
    this.light.value.set(-.3,.7,1).normalize().transformDirection(camera.matrixWorldInverse);
    this.faceLight.value.set(-.3,.7,1).normalize().applyQuaternion(this.headRotation.invert());
    const p = this.profile;
    this.style.value.set(p.enabled ? p.hairHighlight : 0,p.enabled ? p.rimStrength : 0,p.shadowStrength,p.clothingShadow);

  }
  render(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.PerspectiveCamera) {
    this.outline.render(renderer,scene,camera,this.profile.outlinePixels,this.outputScale);
  }
}
