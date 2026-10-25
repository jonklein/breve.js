// Run an example with no browser and no renderer, and print its metrics.
//   node --import tsx scripts/run.mjs <example id> [ticks] [every]
// Example: node --import tsx scripts/run.mjs epidemic 200 20
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene } from '../packages/core/src/index.ts'

const [id, ticks = '300', every = '50'] = process.argv.slice(2)
const index = JSON.parse(readFileSync(new URL('../examples/index.json', import.meta.url), 'utf8'))
const ex = index.find((e) => e.id === id)
if (!ex) { console.error(`no example "${id}". Try one of: ${index.map((e) => e.id).join(', ')}`); process.exit(1) }
const dir = new URL(`../examples/${id}/`, import.meta.url)
const scene = parseScene(readFileSync(new URL(ex.scene, dir), 'utf8'))
if (!scene.ok) { console.error(scene.errors.join('\n')); process.exit(1) }
const script = await import(pathToFileURL(new URL(ex.script, dir).pathname).href)
const sim = await Sim.create(scene.scene, script)
for (let t = 0; t <= Number(ticks); t++) {
  if (t % Number(every) === 0) console.log(t, JSON.stringify(sim.metrics()))
  sim.step()
}
for (const e of sim.takeErrors()) console.error('error:', e)
sim.dispose()
