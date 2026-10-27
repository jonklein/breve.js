import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { ResolvedLook } from './look'

/** Color grading and a vignette in one pass, in linear light before tone mapping. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, vignette: { value: 0 }, saturation: { value: 1 }, contrast: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float saturation; uniform float contrast; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = max((c.rgb - 0.18) * contrast + 0.18, 0.0);
      float d = length((vUv - 0.5) * vec2(1.15, 1.0));
      c.rgb *= mix(1.0, smoothstep(0.95, 0.3, d), vignette);
      gl_FragColor = c;
    }`,
}

export type Quality = 'low' | 'medium' | 'high'

/**
 * The screen effects for one view: ambient occlusion, bloom, grading and a vignette, then tone mapping.
 * It is built the first time it is needed and rebuilt only when the set of effects changes.
 * `low` quality skips everything (a plain render); `medium` drops ambient occlusion, the most expensive pass.
 */
export class Effects {
  private composer: EffectComposer | null = null
  private key = ''
  private grade: ShaderPass | null = null
  private bloom: UnrealBloomPass | null = null
  private ao: GTAOPass | null = null
  private w = 0
  private h = 0

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {}

  /** True if these effects at this quality need the composer (otherwise the caller renders directly). */
  static needed(fx: ResolvedLook['effects'], q: Quality): boolean {
    if (q === 'low') return false
    return !!fx.bloom || (!!fx.ao && q === 'high') || fx.vignette > 0 || fx.saturation !== 1 || fx.contrast !== 1
  }

  private build(fx: ResolvedLook['effects'], q: Quality, size: THREE.Vector2): void {
    this.dispose()
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 })
    const c = (this.composer = new EffectComposer(this.renderer, target))
    c.addPass(new RenderPass(this.scene, this.camera))
    if (fx.ao && q === 'high') {
      this.ao = new GTAOPass(this.scene, this.camera, size.x, size.y)
      c.addPass(this.ao)
    }
    if (fx.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), fx.bloom.strength, fx.bloom.radius, fx.bloom.threshold)
      c.addPass(this.bloom)
    }
    this.grade = new ShaderPass(GradeShader)
    c.addPass(this.grade)
    c.addPass(new OutputPass())
  }

  /** Draw the scene through the effects. `world` is the world's half-size, which ambient occlusion distances scale with. */
  render(fx: ResolvedLook['effects'], q: Quality, world: number): void {
    const size = this.renderer.getSize(new THREE.Vector2())
    const key = JSON.stringify([!!fx.ao && q === 'high', fx.bloom ? 1 : 0, q])
    if (!this.composer || key !== this.key) { this.key = key; this.build(fx, q, size); this.w = size.x; this.h = size.y }
    if (size.x !== this.w || size.y !== this.h) { this.composer!.setSize(size.x, size.y); this.w = size.x; this.h = size.y }
    if (this.bloom && fx.bloom) { this.bloom.strength = fx.bloom.strength; this.bloom.radius = fx.bloom.radius; this.bloom.threshold = fx.bloom.threshold }
    if (this.ao && fx.ao) {
      this.ao.updateGtaoMaterial({ radius: fx.ao.radius * world, distanceExponent: 1, thickness: 1, scale: fx.ao.intensity, samples: 12, distanceFallOff: 1, screenSpaceRadius: false })
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 })
    }
    const u = this.grade!.uniforms as typeof GradeShader.uniforms
    u.vignette.value = fx.vignette
    u.saturation.value = fx.saturation
    u.contrast.value = fx.contrast
    this.composer!.render()
  }

  dispose(): void {
    this.composer?.dispose()
    this.composer = null
    this.ao = null
    this.bloom = null
    this.grade = null
  }
}
