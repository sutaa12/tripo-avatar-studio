import * as T from "three";
import { MToonMaterial } from "@pixiv/three-vrm";

// Bounds of the main white reflection in the original 4096px head projection.
// The iris, pupil and sclera are sampled at their original UVs, never redrawn.
export const eyeReflectionBounds = {
  Left: [2475, 1874, 2568, 2015],
  Right: [1569, 1869, 1632, 2011],
} as const;

export function repairEyeSurfaces(root: T.Object3D, reference: T.Texture) {
  let eyes = 0;
  let skinMap: T.Texture | undefined;
  let skinMaterial: MToonMaterial | undefined;
  root.traverse((o) => {
    const mesh = o as T.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (mat.name === "Eye_Soft_Blush") {
        skinMap = (mat as T.MeshBasicMaterial).map ?? undefined;
        if ((mat as MToonMaterial).isMToonMaterial) skinMaterial = mat as MToonMaterial;
      }
    }
  });
  root.traverse((object) => {
    const mesh = object as T.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !/^Eye_(Left|Right)$/.test(mesh.name)) return;
    if (Array.isArray(mesh.material) || mesh.material.userData.eyeDesign) return;
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new T.Vector3());
    if (size.x <= 0 || size.y <= 0 || !geometry.hasAttribute("uv")) return;

    const side = mesh.name.slice(4) as "Left" | "Right";
    const [x0, y0, x1, y1] = eyeReflectionBounds[side];
    const material = mesh.material as T.MeshBasicMaterial | MToonMaterial;
    const isToon = (material as MToonMaterial).isMToonMaterial;
    material.map = reference;
    if (isToon && skinMaterial) {
      const toon = material as MToonMaterial;
      toon.shadeColorFactor.copy(skinMaterial.shadeColorFactor);
      toon.shadingShiftFactor = skinMaterial.shadingShiftFactor;
      toon.shadingToonyFactor = skinMaterial.shadingToonyFactor;
      toon.giEqualizationFactor = skinMaterial.giEqualizationFactor;
    }
    const prior = material.onBeforeCompile.bind(material);
    const cache = material.customProgramCacheKey.bind(material);
    material.name = `Eye_Design_Reference_${side}`;
    material.userData.eyeDesign = "source-uv-v2";
    const uniforms = {
      eyeSkin: { value: skinMap ?? reference },
      glintCenter: { value: new T.Vector2((x0+x1)/8192, (y0+y1)/8192) },
      glintRadius: { value: new T.Vector2((x1-x0)/8192, (y1-y0)/8192) },
      glintWhite: { value: new T.Color("#eee9eb") },
    };
    material.customProgramCacheKey = () => cache()+":avatar-reference-eye-v2";
    material.onBeforeCompile = (shader,renderer) => {
      prior(shader,renderer);
      if (isToon && shader.uniforms.avatarRole) shader.uniforms.avatarRole.value = 1;
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_pars_fragment>", `#include <map_pars_fragment>
uniform sampler2D eyeSkin;
uniform vec2 glintCenter;
uniform vec2 glintRadius;
uniform vec3 glintWhite;
vec3 repairReferenceEye(vec2 uv, vec3 original) {
  vec2 point = (uv-glintCenter)/glintRadius;
  float radius = length(point);
  float edge = max(fwidth(radius), 0.001);
  // Feather inward, so the reflection cannot extend outside its source bounds.
  float glint = 1.0-smoothstep(1.0-edge,1.0,radius);
  vec2 margin = vec2(0.010,0.004);
  vec2 region = abs(uv-glintCenter)-glintRadius;
  float repairArea = (1.0-smoothstep(margin.x-0.001,margin.x,region.x))
    * (1.0-smoothstep(margin.y-0.001,margin.y,region.y));
  float paleFragment = smoothstep(0.12,0.28,original.g)*repairArea;
  vec3 left = texture2D(map,vec2(glintCenter.x-glintRadius.x-0.005,uv.y)).rgb;
  vec3 right = texture2D(map,vec2(glintCenter.x+glintRadius.x+0.005,uv.y)).rgb;
  vec3 under = mix(left,right,clamp((point.x+1.0)*0.5,0.0,1.0));
  vec3 color = mix(original,under,paleFragment*(1.0-glint));
  color = mix(color,glintWhite,glint);
  // Only the warm skin outside the source sclera is blended into the real lids.
  // Neutral white and the red/pink iris have no positive green-blue difference.
  float skin = smoothstep(0.014,0.045,original.g-original.b)
    * smoothstep(0.15,0.40,original.r);
  vec3 lid = texture2D(eyeSkin,uv).rgb;
  // The lid atlas has black holes. Filtered hole edges must also use valid skin.
  if (lid.r<0.90) lid=texture2D(eyeSkin,vec2(0.5,uv.y)).rgb;
  return mix(color,lid,skin);
}
`);
      shader.fragmentShader = isToon
        ? shader.fragmentShader.replace("diffuseColor *= sampledDiffuseColor;", `diffuseColor *= sampledDiffuseColor;
    diffuseColor.rgb = repairReferenceEye(mapUv,diffuseColor.rgb);`)
        : shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
    diffuseColor.rgb = repairReferenceEye(vMapUv,diffuseColor.rgb);`);
    };
    material.needsUpdate = true;
    mesh.material = material;
    eyes++;
  });
  return { eyes, profile: "source-uv-v2" };
}
