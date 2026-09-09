import * as T from "three";
export class ToonStyle {
  profile = {
    enabled: true,
    outlinePixels: 1.6,
    hairHighlight: 0.14,
    faceShadow: 0.12,
  };
  private materials: any[] = [];
  private up = { value: new T.Vector3(0, 1, 0) };
  private light = { value: new T.Vector3(-0.3, 0.7, 1).normalize() };
  private faceLight = { value: new T.Vector3(-0.3, 0.7, 1).normalize() };
  apply(root: T.Object3D, renderer: T.WebGLRenderer) {
    root.traverse((o) => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh) return;
      const role = mesh.name.startsWith("Hair")
        ? 2
        : mesh.name.startsWith("Head_") && !mesh.name.includes("Choker")
          ? 1
          : 0;
      const transform = (original: any) => {
        if (!original.isMToonMaterial) return original;
        const mat = original.clone();
        this.materials.push(mat);
        mat.userData.role = role;
        if (mat.map)
          mat.map.anisotropy = Math.min(
            8,
            renderer.capabilities.getMaxAnisotropy(),
          );
        const prior = mat.onBeforeCompile.bind(mat),
          cache = mat.customProgramCacheKey.bind(mat);
        mat.customProgramCacheKey = () => cache() + ":avatar-toon-v1:" + role;
        mat.onBeforeCompile = (shader: any) => {
          prior(shader);
          shader.uniforms.avatarUp = this.up;
          shader.uniforms.avatarLight = this.light;
          shader.uniforms.avatarFaceLight = this.faceLight;
          shader.uniforms.avatarStyle = {
            value: new T.Vector3(
              role,
              this.profile.hairHighlight,
              this.profile.faceShadow,
            ),
          };
          mat.userData.styleUniform = shader.uniforms.avatarStyle;
          shader.vertexShader =
            "varying vec3 avatarBind;\n" +
            shader.vertexShader.replace(
              "void main() {",
              "void main() {\n avatarBind = position;",
            );
          shader.fragmentShader =
            "varying vec3 avatarBind;\nuniform vec3 avatarUp;\nuniform vec3 avatarLight;\nuniform vec3 avatarFaceLight;\nuniform vec3 avatarStyle;\n" +
            shader.fragmentShader;
          const enhancement = `
          #ifndef OUTLINE
          if(avatarStyle.x > 1.5){
            vec3 tangent=avatarUp-normal*dot(normal,avatarUp);
            tangent=normalize(tangent+vec3(.0001));
            vec3 halfDir=normalize(normalize(vViewPosition)+avatarLight);
            float th=dot(normalize(tangent+normal*.12),halfDir);
            float strand=sqrt(max(0.0,1.0-th*th));
            float lobe=pow(strand,72.0)+.24*pow(strand,16.0);
            float aa=max(fwidth(lobe),.002);
            float band=smoothstep(.25-aa,.65+aa,lobe);
            col+=diffuseColor.rgb*avatarStyle.y*band*max(0.0,dot(normal,avatarLight));
          }else if(avatarStyle.x>.5){
            float side=avatarBind.x*8.0*sign(avatarFaceLight.x);
            float strength=1.0-clamp(avatarFaceLight.z,0.0,1.0);
            float signedDistance=side+.42-strength*.45;
            float edge=max(fwidth(signedDistance)*1.5,.035);
            float shadow=1.0-smoothstep(-edge,edge,signedDistance);
            col*=mix(vec3(1.0),vec3(.78,.61,.70),shadow*avatarStyle.z);
          }
          #endif
        `;
          shader.fragmentShader = shader.fragmentShader.replace(
            "col += totalEmissiveRadiance;",
            "col += totalEmissiveRadiance;\n" + enhancement,
          );
        };
        return mat;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(transform)
        : transform(mesh.material);
    });
  }
  update(head: T.Object3D | undefined, camera: T.Camera) {
    const q =
      head?.getWorldQuaternion(new T.Quaternion()) ?? new T.Quaternion();
    this.up.value
      .set(0, 1, 0)
      .applyQuaternion(q)
      .transformDirection(camera.matrixWorldInverse);
    this.light.value
      .set(-0.3, 0.7, 1)
      .normalize()
      .transformDirection(camera.matrixWorldInverse);
    this.faceLight.value
      .set(-0.3, 0.7, 1)
      .normalize()
      .applyQuaternion(q.clone().invert());
    for (const mat of this.materials) {
      if (mat.userData.styleUniform)
        mat.userData.styleUniform.value.set(
          this.profile.enabled ? mat.userData.role : 0,
          this.profile.hairHighlight,
          this.profile.faceShadow,
        );
      if (mat.isOutline)
        mat.outlineWidthFactor = this.profile.outlinePixels / 1080;
    }
  }
}
