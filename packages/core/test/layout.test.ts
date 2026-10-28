import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule } from '../src/index'
import { layoutNodes, type LayoutKind } from '../src/layout'
import { Rng } from '../src/rng'

const KINDS: LayoutKind[] = ['force', 'force-sphere', 'circle', 'sphere', 'grid', 'random', 'radial']
// a ring of 12 plus a spoke node and an island, so radial has a root, rings and an unreachable node
const edges: [number, number][] = [...Array.from({ length: 12 }, (_, i) => [i, (i + 1) % 12] as [number, number]), [0, 12]]

test('every layout gives one finite position per node, inside the radius, and the same one for the same seed', () => {
  for (const kind of KINDS) {
    const a = layoutNodes(14, edges, kind, 10, new Rng(5)), b = layoutNodes(14, edges, kind, 10, new Rng(5))
    assert.equal(a.length, 42, kind)
    assert.deepEqual([...a], [...b], `${kind} repeats`)
    for (let i = 0; i < 14; i++) {
      const d = Math.hypot(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])
      assert.ok(Number.isFinite(d) && d <= 10 * 1.75 + 1e-3, `${kind}: node ${i} at ${d}`)
    }
  }
})

test('layouts with nothing to place, or one node, do not blow up', () => {
  for (const kind of KINDS) {
    assert.equal(layoutNodes(0, [], kind, 10, new Rng(1)).length, 0)
    assert.ok([...layoutNodes(1, [], kind, 10, new Rng(1))].every(Number.isFinite), kind)
  }
})

test('radial puts the best-linked node in the middle and farther nodes on wider rings', () => {
  const p = layoutNodes(14, edges, 'radial', 10, new Rng(1))
  const r = (i: number) => Math.hypot(p[i * 3], p[i * 3 + 2])
  assert.equal(r(0), 0)
  assert.ok(r(12) > 0 && r(12) < r(6))
  assert.ok(r(13) >= r(6), 'the unreachable node is on the outermost ring')
})

test('layouts: the example runs, and its controls point at real fields', async () => {
  const dir = new URL('../../../examples/layouts/', import.meta.url)
  const parsed = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n'))
  if (!parsed.ok) return
  const script = (await import(pathToFileURL(new URL('layouts.js', dir).pathname).href)) as ScriptModule
  for (const c of parsed.scene.controls ?? []) {
    let node: unknown = parsed.scene
    for (const k of (c.set ?? '').split('.')) node = (node as Record<string, unknown>)?.[k]
    assert.ok((c.options ?? []).includes(node as string), `${c.set} starts at one of its options`)
  }
  const sim = new Sim(parsed.scene, script)
  for (let t = 0; t < 3; t++) sim.step()
  assert.equal(sim.takeErrors().length, 0)
})

test('controls in a scene are checked', () => {
  const base = { seed: 1, params: {}, entities: [{ name: 'p', count: 2 }], metrics: [] }
  const ok = parseScene(JSON.stringify({ ...base, controls: [{ set: 'a.b', options: ['x', 'y'] }] }))
  assert.ok(ok.ok, ok.ok ? '' : ok.errors.join('\n'))
  assert.ok(!parseScene(JSON.stringify({ ...base, controls: [{ set: 'a.b', options: ['x'] }] })).ok, 'one option is not a choice')
  assert.ok(!parseScene(JSON.stringify({ ...base, controls: [{ options: ['x', 'y'] }] })).ok, 'a control needs a path')
})

test('force-sphere puts every node on the sphere and keeps linked nodes close together', () => {
  // a ring of 60: neighbors in the ring should end up next to each other on the shell
  const n = 60
  const ring: [number, number][] = Array.from({ length: n }, (_, i) => [i, (i + 1) % n])
  const radius = 20
  const forced = layoutNodes(n, ring, 'force-sphere', radius, new Rng(2))
  for (let i = 0; i < n; i++) assert.ok(Math.abs(Math.hypot(forced[i * 3], forced[i * 3 + 1], forced[i * 3 + 2]) - radius) < 1e-3, `node ${i} is on the shell`)
  const linked = (p: Float32Array) => ring.reduce((s, [a, b]) => s + Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]), 0) / ring.length
  // the same spiral of points, but with the links scrambled: what an arrangement that ignores the links gives
  const shuffled = layoutNodes(n, [], 'sphere', radius, new Rng(2))
  assert.ok(linked(forced) < linked(shuffled) * 0.8, `linked nodes ${linked(forced).toFixed(1)} apart on average, against ${linked(shuffled).toFixed(1)} for an unrelated arrangement`)
})

test('changing a network\'s layout in the scene moves the nodes at once, and the links are told (a new graph version)', async () => {
  const p = parseScene(readFileSync(new URL('../../../examples/epidemic/scene.json', import.meta.url), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('../../../examples/epidemic/contagion.js', import.meta.url).pathname).href)) as ScriptModule
  const sim = new Sim(structuredClone(p.scene), script)
  for (let t = 0; t < 5; t++) sim.step()
  const before = sim.frames()[0]
  const next = structuredClone(p.scene)
  next.entities[0].network!.layout = 'circle'
  sim.setScene(next)
  const after = sim.frames()[0]
  assert.ok(after.graph!.version > before.graph!.version, 'links redraw')
  assert.notDeepEqual([...after.pos.slice(0, 9)], [...before.pos.slice(0, 9)], 'nodes moved')
  const r = Math.hypot(after.pos[0], after.pos[1], after.pos[2])
  assert.ok(Math.abs(r - (next.entities[0].network!.radius ?? 20)) < 1e-3, `on the circle of the radius, got ${r}`)
  assert.equal(sim.takeErrors().length, 0)
})
