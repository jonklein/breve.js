// Physics spike numbers for docs/decisions/physics.md.  Run: node --import tsx bench/physics.bench.ts
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type Scene, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/creature/', import.meta.url)
const parsed = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
const script = (await import(pathToFileURL(new URL('creature.js', dir).pathname).href)) as ScriptModule

async function make(count: number, substeps?: number): Promise<Sim> {
  const scene: Scene = structuredClone(parsed.ok ? parsed.scene : (null as never))
  scene.params.count = count
  if (substeps) scene.physics = { ...scene.physics, substeps }
  return Sim.create(scene, script)
}

let t = performance.now()
const warm = await make(1)
console.log(`load + first world: ${(performance.now() - t).toFixed(0)} ms`)
warm.dispose()

for (const substeps of [4, 2]) {
  for (const count of [1, 20]) {
    const sim = await make(count, substeps)
    for (let i = 0; i < 60; i++) sim.step() // warm up
    const ticks = count === 1 ? 3000 : 1000
    t = performance.now()
    for (let i = 0; i < ticks; i++) sim.step()
    const s = (performance.now() - t) / 1000
    console.log(`substeps ${substeps}, ${String(count).padStart(2)} creatures: ${(ticks / s).toFixed(0)} ticks/s (${((s / ticks) * 1000).toFixed(2)} ms/tick, ${(ticks / s / 60).toFixed(1)}x realtime)`)
    sim.dispose()
  }
}

// determinism: two runs in this process; compare the printed hash across separate processes too
const a = await make(8), b = await make(8)
for (let i = 0; i < 1000; i++) { a.step(); b.step() }
console.log(`determinism after 1000 ticks, 8 creatures: ${a.hash() === b.hash() ? 'identical' : 'DIFFERENT'}  hash ${a.hash()}`)
