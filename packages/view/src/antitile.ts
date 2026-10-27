import * as THREE from 'three'

/**
 * Break up the repeat of a tiled ground texture: modulate the color with soft, large-scale noise in world space,
 * so no two tiles look quite the same and the pattern does not read as a grid from far away. Visual only.
 */
export function antiTile(mat: THREE.MeshStandardMaterial, scale = 0.035, amount = 0.28): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
float atHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float atNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(atHash(i), atHash(i + vec2(1, 0)), f.x), mix(atHash(i + vec2(0, 1)), atHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 q = vWorldPos.xz * ${scale.toFixed(4)};
  float n = atNoise(q) * 0.65 + atNoise(q * 2.7 + 9.0) * 0.35;
  diffuseColor.rgb *= 1.0 - ${amount.toFixed(3)} * 0.5 + ${amount.toFixed(3)} * n;
  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), n - 0.5); // a little warmer in the light patches
}`)
  }
  mat.customProgramCacheKey = () => `antitile:${scale}:${amount}`
}
