import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, withParams, type ScriptModule } from '../src/index'

async function load(id: string, script: string) {
  const dir = new URL(`../../../examples/${id}/`, import.meta.url)
  const p = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  return { scene: p.ok ? p.scene : (null as never), script: (await import(pathToFileURL(new URL(script, dir).pathname).href)) as ScriptModule }
}

test('gray-scott: a pattern grows from a few blobs, both chemicals stay between 0 and 1, and the run is repeatable', async () => {
  const { scene, script } = await load('gray-scott', 'gray-scott.js')
  const a = new Sim(scene, script), b = new Sim(scene, script)
  const start = a.metrics().chemicalV
  for (let t = 0; t < 120; t++) { a.step(); b.step() }
  assert.equal(a.takeErrors().length, 0, a.takeErrors().join('\n'))
  assert.equal(a.hash(), b.hash())
  const v = a.table.cols.v as unknown as Float32Array, u = a.table.cols.u as unknown as Float32Array
  assert.ok(a.metrics().chemicalV > start * 2, `v grew from ${start} to ${a.metrics().chemicalV}`)
  assert.ok(Math.min(...v) >= 0 && Math.max(...v) <= 1 && Math.min(...u) >= 0 && Math.max(...u) <= 1)
  const mean = v.reduce((s, x) => s + x, 0) / v.length
  const spread = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length)
  assert.ok(spread > 0.05, `the sheet has structure, not a flat wash (spread ${spread.toFixed(3)})`)
  // with no food added and no v removed beyond the default, a dead setting (kill too high) lets the pattern fade
  const dying = new Sim(withParams(scene, { kill: 0.075, feed: 0.01 }), script)
  for (let t = 0; t < 120; t++) dying.step()
  assert.ok(dying.metrics().chemicalV < a.metrics().chemicalV, 'a bad feed and kill gives less pattern')
})

test('hypercycle: all five members coexist when they help each other, and parasites take over', async () => {
  const { scene, script } = await load('hypercycle', 'hypercycle.js')
  const run = async (params: Record<string, number>, ticks: number) => {
    const s = new Sim(withParams(scene, params), script)
    for (let t = 0; t < ticks; t++) s.step()
    assert.equal(s.takeErrors().length, 0)
    return { s, m: s.metrics() }
  }
  const healthy = await run({}, 400)
  for (const k of ['member1', 'member2', 'member3', 'member4', 'member5'] as const) assert.ok(healthy.m[k] > 300, `${k} holds ${healthy.m[k]} cells`)
  assert.equal(healthy.m.parasites, 0)
  const again = await run({}, 400)
  assert.equal(again.s.hash(), healthy.s.hash(), 'repeatable')
  const infected = await run({ parasites: 1.5 }, 500)
  const members = infected.m.member1 + infected.m.member2 + infected.m.member3 + infected.m.member4 + infected.m.member5
  assert.ok(infected.m.parasites > members, `parasites (${infected.m.parasites}) outnumber the ring (${members})`)
})
