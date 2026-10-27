import * as THREE from 'three'
import { generateTexture, normalMapFrom, normalizeTexture } from './texture-gen'

export interface BuiltTexture {
  map: THREE.Texture
  normalMap: THREE.Texture | null
}

const cache = new Map<string, BuiltTexture>()

function dataTexture(rgba: Uint8ClampedArray, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), size, size, THREE.RGBAFormat)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.generateMipmaps = true
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

/**
 * Turn a texture setting (a name like "grass", or an object) into three.js textures: a color map and, when the
 * texture has relief, a normal map. Generated textures are made once per distinct setting and reused. An image
 * `url` shows a plain placeholder until it loads, and keeps it (with a console warning) if it cannot be loaded.
 * `assetBase` is where relative URLs start; `changed` is called when a late image arrives.
 */
export function buildTexture(def: unknown, opts: { size?: number; assetBase?: string; changed?: () => void } = {}): BuiltTexture {
  const spec = normalizeTexture(def)!
  const key = JSON.stringify([spec, opts.size, opts.assetBase])
  const hit = cache.get(key)
  if (hit) return hit
  let built: BuiltTexture
  if (spec.kind === 'url') {
    const placeholder = dataTexture(new Uint8ClampedArray([160, 160, 160, 255]), 1, true)
    const map: THREE.Texture = placeholder
    built = { map, normalMap: null }
    const url = /^(https?:|data:|blob:|\/)/.test(spec.url) ? spec.url : (opts.assetBase ?? '') + spec.url
    new THREE.TextureLoader().load(
      url,
      (img) => {
        img.colorSpace = THREE.SRGBColorSpace
        img.wrapS = img.wrapT = THREE.RepeatWrapping
        img.anisotropy = 8
        built.map = img
        opts.changed?.()
      },
      undefined,
      () => console.warn(`could not load the texture ${url}: showing a plain surface instead`),
    )
  } else {
    const g = generateTexture(spec, opts.size ?? 512)
    built = {
      map: dataTexture(g.rgba, g.size, true),
      normalMap: spec.bump > 0 ? dataTexture(normalMapFrom(g.height, g.size, spec.bump), g.size, false) : null,
    }
  }
  cache.set(key, built)
  return built
}
