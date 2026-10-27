import { normalizeTexture } from './texture-gen'

/**
 * What a scene's `world` block means in plain numbers. Pure (no three.js, no GL), so it can be tested anywhere:
 * a preset supplies defaults for sky, fog, light, shadows and reflections, and every field in the scene overrides it.
 */

export interface LookInput {
  floor?: unknown
  preset?: unknown
  sky?: unknown
  fog?: unknown
  light?: unknown
  reflections?: unknown
  grid?: unknown
  boundsColor?: unknown
  agentColor?: unknown
  shadows?: unknown
}

export type ToneMapping = 'none' | 'aces' | 'neutral'

export interface ResolvedLook {
  preset: string
  sky: { top: string; horizon: string; ground: string }
  fog: { kind: 'none' | 'linear' | 'exp'; color: string; near: number; far: number; density: number }
  sun: { color: string; intensity: number; azimuth: number; elevation: number }
  ambient: { color: string; intensity: number }
  hemisphere: { sky: string; ground: string; intensity: number }
  exposure: number
  toneMapping: ToneMapping
  /** `undefined` means "decide by scene kind" (on for physics scenes, off otherwise). */
  shadows: { enabled: boolean | undefined; softness: number; resolution: 512 | 1024 | 2048 | 4096; bias: number }
  reflections: number
  grid: boolean
  boundsColor: string
  /** A fixed agent color, or null for "by heading". */
  agentColor: string | null
  /** The ground plane, or null for none. `y` and `size` are null when they should follow the world's size. */
  floor: null | { color: string; texture: ReturnType<typeof normalizeTexture>; y: number | null; size: number | null; roughness: number; metalness: number }
}

interface Preset {
  sky: { top: string; horizon: string; ground: string }
  fog: false | { color?: string; near: number; far: number }
  sun: ResolvedLook['sun']
  ambient: ResolvedLook['ambient']
  hemisphere: ResolvedLook['hemisphere']
  exposure: number
  toneMapping: ToneMapping
  softness: number
  reflections: number
}

/** `near` and `far` for fog are multiples of the world's size, so a preset suits a small arena and a big one alike. */
export const PRESETS: Record<string, Preset> = {
  plain: {
    sky: { top: '#0b1226', horizon: '#2a4a7a', ground: '#122034' }, fog: false,
    sun: { color: '#ffffff', intensity: 1.6, azimuth: 32, elevation: 52 },
    ambient: { color: '#ffffff', intensity: 0.9 }, hemisphere: { sky: '#ffffff', ground: '#444444', intensity: 0 },
    exposure: 1, toneMapping: 'none', softness: 1, reflections: 0,
  },
  day: {
    sky: { top: '#3f86d6', horizon: '#cfe4f4', ground: '#7d8f86' }, fog: { near: 1.6, far: 7 },
    sun: { color: '#fff1d6', intensity: 2.6, azimuth: 40, elevation: 52 },
    ambient: { color: '#ffffff', intensity: 0.2 }, hemisphere: { sky: '#bcd9ff', ground: '#6e6450', intensity: 1.0 },
    exposure: 1, toneMapping: 'aces', softness: 1.5, reflections: 0.7,
  },
  dusk: {
    sky: { top: '#141f45', horizon: '#c8704f', ground: '#2b2233' }, fog: { color: '#6d4a5c', near: 1.8, far: 8 },
    sun: { color: '#ffb27a', intensity: 2.8, azimuth: 235, elevation: 16 },
    ambient: { color: '#a090c0', intensity: 0.35 }, hemisphere: { sky: '#8a9ad8', ground: '#4a3a50', intensity: 1.2 },
    exposure: 1.1, toneMapping: 'aces', softness: 2, reflections: 0.9,
  },
  night: {
    sky: { top: '#03050d', horizon: '#0f1b36', ground: '#05070f' }, fog: { color: '#0a1228', near: 1.6, far: 7.5 },
    sun: { color: '#9dbcff', intensity: 1.3, azimuth: 120, elevation: 40 },
    ambient: { color: '#4a5a8a', intensity: 0.4 }, hemisphere: { sky: '#3a4f8e', ground: '#10131f', intensity: 0.9 },
    exposure: 1.2, toneMapping: 'aces', softness: 2, reflections: 0.5,
  },
  studio: {
    sky: { top: '#2a2e36', horizon: '#4b515c', ground: '#1e2126' }, fog: false,
    sun: { color: '#ffffff', intensity: 2.4, azimuth: 30, elevation: 55 },
    ambient: { color: '#ffffff', intensity: 0.1 }, hemisphere: { sky: '#ffffff', ground: '#5a5f68', intensity: 0.9 },
    exposure: 1, toneMapping: 'neutral', softness: 2.5, reflections: 1,
  },
  space: {
    sky: { top: '#000000', horizon: '#06070f', ground: '#000000' }, fog: false,
    sun: { color: '#ffffff', intensity: 2.8, azimuth: 60, elevation: 28 },
    ambient: { color: '#233055', intensity: 0.18 }, hemisphere: { sky: '#101830', ground: '#05060a', intensity: 0.25 },
    exposure: 1, toneMapping: 'aces', softness: 0.5, reflections: 0.3,
  },
}

/** The look used when a scene has no `world` block at all. */
export const DEFAULT_PRESET = 'dusk'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback)

/** Blend two #rrggbb colors: `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const full = (c: string) => (c.length === 4 ? '#' + [...c.slice(1)].map((h) => h + h).join('') : c)
  const pa = full(a), pb = full(b)
  const ch = (i: number) => Math.round(parseInt(pa.slice(1 + i * 2, 3 + i * 2), 16) * (1 - t) + parseInt(pb.slice(1 + i * 2, 3 + i * 2), 16) * t)
  return '#' + [0, 1, 2].map((i) => ch(i).toString(16).padStart(2, '0')).join('')
}

/** Work out the final look. `size` is the world's half-width, which fog distances scale with. */
export function resolveLook(world: LookInput | undefined, size = 30): ResolvedLook {
  const name = typeof world?.preset === 'string' && world.preset in PRESETS ? world.preset : world ? 'plain' : DEFAULT_PRESET
  const p = PRESETS[name]

  // sky: a single color flattens the gradient
  let sky = p.sky
  if (typeof world?.sky === 'string') { const c = str(world.sky, p.sky.top); sky = { top: c, horizon: c, ground: c } }
  else if (isObj(world?.sky)) {
    const horizon = str(world.sky.horizon, p.sky.horizon)
    // a sky given without a ground gets one a little darker than its horizon
    sky = { top: str(world.sky.top, p.sky.top), horizon, ground: str(world.sky.ground, 'ground' in world.sky || !('horizon' in world.sky) ? p.sky.ground : mix(horizon, '#000000', 0.55)) }
  }

  // fog: off, the preset's, linear (near/far) or exponential (density)
  const fogIn = world?.fog
  const base = p.fog
  const haze = mix(sky.horizon, sky.ground, 0.55) // what the eye sees looking down into the distance
  const none: ResolvedLook['fog'] = { kind: 'none', color: haze, near: 0, far: 0, density: 0 }
  let fog = none
  if (isObj(fogIn)) {
    const color = str(fogIn.color, str(base ? base.color : undefined, haze))
    if (typeof fogIn.density === 'number') fog = { kind: 'exp', color, near: 0, far: 0, density: Math.max(0, fogIn.density) }
    else {
      const near = num(fogIn.near, (base ? base.near : 1.6) * size)
      fog = { kind: 'linear', color, near, far: Math.max(near + 1e-3, num(fogIn.far, (base ? base.far : 7) * size)), density: 0 }
    }
  } else if (fogIn !== false && (base || fogIn === true)) {
    const b = base || { near: 1.6, far: 7 }
    fog = { kind: 'linear', color: str(base ? base.color : undefined, haze), near: b.near * size, far: b.far * size, density: 0 }
  }

  const light = isObj(world?.light) ? world.light : {}
  const sunIn = isObj(light.sun) ? light.sun : {}
  const ambIn = isObj(light.ambient) ? light.ambient : {}
  const hemIn = isObj(light.hemisphere) ? light.hemisphere : {}
  const tm = light.toneMapping === 'none' || light.toneMapping === 'aces' || light.toneMapping === 'neutral' ? light.toneMapping : p.toneMapping

  const sh = world?.shadows
  const shIn = isObj(sh) ? sh : {}
  const res = [512, 1024, 2048, 4096].includes(shIn.resolution as number) ? (shIn.resolution as 512 | 1024 | 2048 | 4096) : 2048

  const refl = world?.reflections
  return {
    preset: name,
    sky,
    fog,
    sun: {
      color: str(sunIn.color, p.sun.color), intensity: Math.max(0, num(sunIn.intensity, p.sun.intensity)),
      azimuth: num(sunIn.azimuth, p.sun.azimuth), elevation: Math.max(-90, Math.min(90, num(sunIn.elevation, p.sun.elevation))),
    },
    ambient: { color: str(ambIn.color, p.ambient.color), intensity: Math.max(0, num(ambIn.intensity, p.ambient.intensity)) },
    hemisphere: { sky: str(hemIn.sky, p.hemisphere.sky), ground: str(hemIn.ground, p.hemisphere.ground), intensity: Math.max(0, num(hemIn.intensity, p.hemisphere.intensity)) },
    exposure: Math.max(0.01, num(light.exposure, p.exposure)),
    toneMapping: tm,
    shadows: {
      enabled: typeof sh === 'boolean' ? sh : isObj(sh) ? true : undefined,
      softness: Math.max(0, Math.min(4, num(shIn.softness, p.softness))),
      resolution: res,
      bias: num(shIn.bias, -0.0004),
    },
    reflections: refl === false ? 0 : refl === true || refl === undefined ? p.reflections : Math.max(0, Math.min(2, num(refl, p.reflections))),
    grid: world?.grid !== false,
    boundsColor: str(world?.boundsColor, '#3a4658'),
    floor: resolveFloor(world?.floor),
    agentColor: typeof world?.agentColor === 'string' && world.agentColor !== 'heading' ? str(world.agentColor, '#ffffff') : null,
  }
}

function resolveFloor(f: unknown): ResolvedLook['floor'] {
  if (!isObj(f)) return null
  return {
    color: str(f.color, '#ffffff'),
    texture: f.texture === undefined ? null : normalizeTexture(f.texture),
    y: typeof f.y === 'number' ? f.y : null,
    size: typeof f.size === 'number' && f.size > 0 ? f.size : null,
    roughness: Math.max(0, Math.min(1, num(f.roughness, 0.9))),
    metalness: Math.max(0, Math.min(1, num(f.metalness, 0))),
  }
}

/** A unit vector pointing from the scene toward the sun. Azimuth runs from +x toward +z; elevation lifts it above the horizon. */
export function sunDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]
}
