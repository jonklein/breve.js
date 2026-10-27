/** The sky dome's shader: a three-color gradient, with an optional sun, stars and clouds. */

export const SKY_VERTEX = 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

export const SKY_FRAGMENT = /* glsl */ `
uniform vec3 top; uniform vec3 horizon; uniform vec3 ground;
uniform vec3 sunDir; uniform vec3 sunColor;
uniform float sunAmount; uniform float stars; uniform float clouds;
varying vec3 vDir;

float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }

void main() {
  vec3 d = normalize(vDir);
  float t = d.y;
  vec3 c = t >= 0.0 ? mix(horizon, top, pow(t, 0.6)) : mix(horizon, ground, smoothstep(0.0, 0.45, -t));
  float sunUp = smoothstep(-0.08, 0.06, sunDir.y);

  if (t > 0.0) {
    // stars: a sparse field of points, fading toward the horizon and when the sun is up
    if (stars > 0.0) {
      vec3 cell = d * 70.0;
      vec3 id = floor(cell);
      float r = h31(id);
      float dist = length(fract(cell) - 0.5);
      float tw = 0.65 + 0.35 * h31(id + 7.0);
      float star = step(0.985, r) * smoothstep(0.22, 0.0, dist) * tw;
      c += vec3(0.9, 0.95, 1.0) * star * stars * smoothstep(0.02, 0.4, t) * (1.0 - sunUp);
    }
    // clouds: noise on a plane high above, lit from the sun's side, thinning toward the horizon
    if (clouds > 0.0) {
      vec2 uv = d.xz / (t + 0.18) * 0.9 + 3.0;
      float n = fbm(uv);
      float cover = smoothstep(1.0 - clouds * 0.75, 1.0 - clouds * 0.75 + 0.28, n);
      float lit = clamp(0.55 + 0.9 * (fbm(uv + sunDir.xz * 0.25) - n), 0.0, 1.0);
      vec3 cloud = mix(horizon * 0.8, mix(vec3(1.0), sunColor, 0.45), lit);
      c = mix(c, cloud, cover * smoothstep(0.0, 0.22, t) * 0.85);
    }
  }

  // the sun: a disc, a tight glow and a wide warm haze around it
  if (sunAmount > 0.0) {
    float s = max(dot(d, normalize(sunDir)), 0.0);
    float disc = smoothstep(0.9993, 0.9998, s) * 6.0;
    float glow = pow(s, 90.0) * 0.9 + pow(s, 9.0) * 0.22;
    c += sunColor * (disc + glow) * sunAmount * (t > -0.05 ? 1.0 : 0.0);
  }
  gl_FragColor = vec4(c, 1.0);
#include <colorspace_fragment>
}
`
