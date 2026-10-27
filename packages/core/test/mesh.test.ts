import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Sim, glbPoints, parseScene, registerAssetReader, resolveMeshes, type Scene } from '../src/index'

const dir = new URL('../../../examples/creature-gltf/', import.meta.url)
const beetle = new Uint8Array(readFileSync(new URL('beetle.glb', dir)))
const load = (): Scene => {
  const p = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  return p.ok ? { ...p.scene, physics: { ...p.scene.physics } } : (null as never)
}

test('a GLB file gives its vertices, with node transforms applied', () => {
  const pts = glbPoints(beetle)
  assert.ok(pts.length >= 12 && pts.length % 3 === 0)
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < pts.length; i += 3) { lo = Math.min(lo, pts[i]); hi = Math.max(hi, pts[i]) }
  assert.ok(hi - lo > 0.9 && hi - lo < 1.4, `the beetle is about a metre long (${(hi - lo).toFixed(2)})`)
  assert.throws(() => glbPoints(new Uint8Array(40)), /not a GLB/)
})

test('a mesh part gets its hull points and extent from the model, and a scene without meshes comes back untouched', async () => {
  const scene = load()
  const bad = await resolveMeshes(scene, undefined).catch((e: Error) => e)
  assert.match(String(bad), /registerAssetReader/)
  const out = await resolveMeshes(scene, async () => beetle)
  const torso = out.entities[0].body!.parts[0]
  assert.equal(torso.shape, 'mesh')
  assert.ok(torso.points!.length >= 12 && torso.points!.length <= 9000)
  assert.ok(torso.size.every((v) => v > 0.1 && v < 1.5), `extent ${torso.size}`)
  assert.equal(await resolveMeshes(out, async () => { throw new Error('read again') }), out, 'already resolved: nothing is read')
})

test('creatures with a modeled body stand on the ground and walk using the real shape', async () => {
  registerAssetReader(async () => beetle)
  const sim = await Sim.create(load())
  const root = () => sim.table.cols // positions of the walkers
  for (let t = 0; t < 120; t++) sim.step()
  assert.equal(sim.takeErrors().length, 0)
  const y = (root().py as unknown as Float32Array)[0]
  assert.ok(y > 0.1 && y < 1.5, `the torso rests at a sensible height (${y})`)
  registerAssetReader(undefined)
})
