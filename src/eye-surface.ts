import * as T from "three";

/** The imported eye atlas also contains skin and lashes. Draw only the eyeball
 * here; the existing, head-bound eyelids and original lashes own its boundary. */
export function repairEyeSurfaces(root: T.Object3D) {
  let eyes = 0;
  root.traverse((object) => {
    const mesh = object as T.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !/^Eye_(Left|Right)$/.test(mesh.name)) return;
    if (Array.isArray(mesh.material) || mesh.material.userData.eyeDesign) return;
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const center = bounds.getCenter(new T.Vector3());
    const size = bounds.getSize(new T.Vector3());
    if (size.x <= 0 || size.y <= 0) return;

    const material = new T.MeshBasicMaterial({
      color: 0xffffff, side: mesh.material.side, toneMapped: false,
    });
    material.name = `Eye_Design_Clean_${mesh.name.slice(4)}`;
    material.userData.eyeDesign = "pink-iris-v1";
    const uniforms = {
      eyeCenter: { value: new T.Vector2(center.x, center.y - size.y * .012) },
      eyeRadius: { value: new T.Vector2(size.x * .315, size.y * .49) },
      eyeWhite: { value: new T.Color("#fff8f4") },
      eyeTop: { value: new T.Color("#572035") },
      eyeBottom: { value: new T.Color("#d54d71") },
      eyePupil: { value: new T.Color("#6b203d") },
      eyeInk: { value: new T.Color("#3e1928") },
      eyeGlint: { value: new T.Color("#fffaf6") },
      eyeRose: { value: new T.Color("#ffa0bc") },
    };
    material.customProgramCacheKey = () => "avatar-clean-eye-v1";
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = `uniform vec2 eyeCenter;
uniform vec2 eyeRadius;
varying vec2 eyePoint;
` + shader.vertexShader.replace("void main() {", `void main() {
  eyePoint = (position.xy - eyeCenter) / eyeRadius;`);
      shader.fragmentShader = `varying vec2 eyePoint;
uniform vec3 eyeWhite;
uniform vec3 eyeTop;
uniform vec3 eyeBottom;
uniform vec3 eyePupil;
uniform vec3 eyeInk;
uniform vec3 eyeGlint;
uniform vec3 eyeRose;
float eyeEllipse(vec2 point, vec2 center, vec2 radii) {
  float distance = length((point - center) / radii);
  float antialias = max(fwidth(distance), 0.001);
  return 1.0 - smoothstep(1.0-antialias, 1.0+antialias, distance);
}
vec3 cleanEye(vec2 point) {
  float radius = length(point);
  float antialias = max(fwidth(radius), 0.001);
  float iris = 1.0-smoothstep(1.0-antialias, 1.0+antialias, radius);
  float rim = smoothstep(0.945-antialias, 0.98+antialias, radius);
  float lower = 1.0-smoothstep(-0.88, 0.45, point.y);
  vec3 color = mix(eyeTop, eyeBottom, lower);
  float pupil = eyeEllipse(point, vec2(0.0, 0.15), vec2(0.43, 0.66));
  color = mix(color, eyePupil, pupil * 0.8);
  float bottomGlow = exp(-pow((point.y+0.75)/0.23,2.0))
    * (1.0-smoothstep(0.30,0.88,abs(point.x)));
  color = mix(color, eyeRose, bottomGlow*0.28*(1.0-pupil));
  color = mix(color, eyeInk, rim);
  float reflections = eyeEllipse(point, vec2(-0.49,-0.59), vec2(0.085,0.08))
    + eyeEllipse(point, vec2(0.47,-0.55), vec2(0.085,0.08));
  color = mix(color, eyeRose, min(reflections,1.0)*0.66);
  // A complete ellipse replaces the fractured white shapes in the baked atlas.
  vec2 tilted = vec2(point.x + 0.12*(point.y-0.32), point.y);
  float highlight = eyeEllipse(tilted, vec2(0.12,0.32), vec2(0.16,0.25));
  float topGlint = eyeEllipse(point, vec2(-0.34,0.70), vec2(0.105,0.065));
  color = mix(color, eyeGlint, max(highlight,topGlint));
  return mix(eyeWhite,color,iris);
}
` + shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
  diffuseColor.rgb = cleanEye(eyePoint);`);
    };
    mesh.material = material;
    eyes++;
  });
  return { eyes, profile: "pink-iris-v1" };
}
