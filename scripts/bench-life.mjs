// Headless benchmark: Life on a big flat grid. Usage: node --import tsx scripts/bench-life.mjs [side]
import { readFileSync } from 'node:fs'
import { Sim, parseScene } from '../packages/core/src/index.ts'
import * as script from '../examples/life2d/life.js'

const side = Number(process.argv[2] ?? 1000)
const p = parseScene(readFileSync(new URL('../examples/life2d/scene.json', import.meta.url), 'utf8'))
if (!p.ok) throw new Error(p.errors.join('\n'))
p.scene.entities[0].lattice.size = [side, side, 1]

const ms = (f) => { const t = performance.now(); const r = f(); return [performance.now() - t, r] }
const [build] = ms(() => (globalThis.sim = new Sim(p.scene, script)))
const sim = globalThis.sim
sim.step()
const [step] = ms(() => { for (let i = 0; i < 5; i++) sim.step() })
const [snap, s] = ms(() => sim.snapshot())
const [fork] = ms(() => sim.fork())
const [restore] = ms(() => sim.restore(s))
const [hash] = ms(() => sim.hash())
console.log(JSON.stringify({ cells: side * side, build: Math.round(build), stepMs: +(step / 5).toFixed(1), snapshotMs: +snap.toFixed(1), forkMs: +fork.toFixed(1), restoreMs: +restore.toFixed(1), hashMs: +hash.toFixed(1) }))
