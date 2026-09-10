import * as T from "three";

/** Derive lines from the rendered, deformed surface so open garment folds cannot become black hull faces. */
export class ToonOutline {
  private target = new T.WebGLRenderTarget(900,1080,{samples:4,type:T.HalfFloatType});
  private scene = new T.Scene();
  private camera = new T.Camera();
  private material: T.ShaderMaterial;
  private configured = false;
  readonly stats = { colorBuffer: "", samples: 0, surfaceDraws: 0, surfaceTriangles: 0 };
  constructor() {
    this.target.depthTexture = new T.DepthTexture(900,1080,T.UnsignedIntType);
    this.material = new T.ShaderMaterial({
      depthTest:false,depthWrite:false,
      uniforms:{surface:{value:this.target.texture},depth:{value:this.target.depthTexture},
        texel:{value:new T.Vector2(1/900,1/1080)},radius:{value:2},clip:{value:new T.Vector2(.01,20)}},
      vertexShader:`varying vec2 uvScreen;
void main(){uvScreen=position.xy*0.5+0.5;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader:`uniform sampler2D surface;
uniform sampler2D depth;
uniform vec2 texel;
uniform vec2 clip;
uniform float radius;
varying vec2 uvScreen;
#include <common>
#include <packing>
float eyeDepth(vec2 uv){return -perspectiveDepthToViewZ(texture2D(depth,uv).r,clip.x,clip.y);}
void main(){
  vec4 base=texture2D(surface,uvScreen);
  float coverage=base.a;
  vec3 edgeColor=base.rgb;
  float edgeWeight=base.a;
  float centerDepth=eyeDepth(uvScreen);
  float inner=0.0;
  for(int i=0;i<16;i++){
    float angle=float(i)*0.3926990817;
    vec2 offset=vec2(cos(angle),sin(angle))*texel*radius;
    vec4 sampleColor=texture2D(surface,uvScreen+offset);
    coverage=max(coverage,sampleColor.a);
    edgeColor+=sampleColor.rgb;edgeWeight+=sampleColor.a;
    // Only the farther surface receives an internal line, at real depth discontinuities.
    if(i<4){
      float a=float(i)*1.570796327;
      vec2 nearUv=uvScreen+vec2(cos(a),sin(a))*texel*max(0.7,radius*0.55);
      float neighborDepth=eyeDepth(nearUv);
      float valid=step(0.98,texture2D(surface,nearUv).a)*step(0.98,base.a);
      float gap=centerDepth-neighborDepth;
      inner=max(inner,smoothstep(0.012,0.026,gap)*valid);
    }
  }
  edgeColor/=max(edgeWeight,0.0001);
  vec3 ink=mix(vec3(0.024,0.010,0.019),edgeColor*vec3(0.17,0.10,0.13),0.65);
  float line=coverage*(1.0-base.a)*step(0.001,radius);
  vec3 color=base.rgb/max(base.a,0.0001);
  float warmSkin=smoothstep(0.005,0.035,color.g-color.b)*smoothstep(0.18,0.4,color.r);
  color=mix(color,ink,inner*0.50*(1.0-warmSkin)*step(0.001,radius));
  float alpha=base.a+line;
  color=(color*base.a+ink*line)/max(alpha,0.0001);
  gl_FragColor=vec4(color,alpha);
  #include <colorspace_fragment>
  gl_FragColor.rgb*=gl_FragColor.a;
}`,
    });
    const geometry=new T.BufferGeometry();
    geometry.setAttribute("position",new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
    const quad=new T.Mesh(geometry,this.material);quad.frustumCulled=false;this.scene.add(quad);
  }
  render(renderer:T.WebGLRenderer,scene:T.Scene,camera:T.PerspectiveCamera,pixels:number,scale:number) {
    if (!this.configured) {
      const hdr = renderer.extensions.has("EXT_color_buffer_float");
      this.target.texture.type = hdr ? T.HalfFloatType : T.UnsignedByteType;
      this.target.samples = Math.min(4,renderer.capabilities.maxSamples);
      this.stats.colorBuffer = hdr ? "RGBA16F" : "RGBA8";
      this.stats.samples = this.target.samples;
      this.configured = true;
    }
    this.material.uniforms.radius.value=Math.max(0,pixels)/Math.max(.25,scale);
    this.material.uniforms.clip.value.set(camera.near,camera.far);
    renderer.setRenderTarget(this.target);renderer.render(scene,camera);
    this.stats.surfaceDraws = renderer.info.render.calls;
    this.stats.surfaceTriangles = renderer.info.render.triangles;
    renderer.setRenderTarget(null);renderer.render(this.scene,this.camera);
  }
}
