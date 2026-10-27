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

test('gray-scott: every preset button and palette names real fields and a real palette', async () => {
  const { scene } = await load('gray-scott', 'gray-scott.js')
  const doc = scene as unknown as Record<string, unknown>
  const at = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], doc)
  for (const c of scene.controls ?? []) {
    for (const pr of c.presets ?? []) for (const path of Object.keys(pr.values)) assert.notEqual(at(path), undefined, `${pr.label}: ${path}`)
    if (c.set) assert.notEqual(at(c.set), undefined, c.set)
  }
})

test('hypercycle: all five chemicals coexist as waves, the total stays 1 in every cell, and the run is repeatable', async () => {
  const { scene, script } = await load('hypercycle', 'hypercycle.js')
  const run = (ticks: number) => {
    const s = new Sim(scene, script)
    for (let t = 0; t < ticks; t++) s.step()
    assert.equal(s.takeErrors().length, 0, s.takeErrors().join('\n'))
    return s
  }
  const a = run(300)
  assert.equal(a.hash(), run(300).hash(), 'repeatable')
  const x = ['a', 'b', 'c', 'd', 'e'].map((k) => a.table.cols[k] as unknown as Float32Array)
  const n = x[0].length
  const wins = [0, 0, 0, 0, 0]
  let worst = 0
  for (let i = 0; i < n; i++) {
    let sum = 0, best = 0
    for (let k = 0; k < 5; k++) { sum += x[k][i]; if (x[k][i] > x[best][i]) best = k }
    wins[best]++
    worst = Math.max(worst, Math.abs(sum - 1))
  }
  assert.ok(worst < 0.02, `the chemicals in a cell add up to 1 (off by ${worst})`)
  for (let k = 0; k < 5; k++) assert.ok(wins[k] > n * 0.05, `chemical ${k + 1} leads in ${wins[k]} of ${n} cells`)
})
