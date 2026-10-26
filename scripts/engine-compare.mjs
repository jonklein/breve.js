// Compare the two physics engines on the thing that matters for evolved creatures: random jointed bodies with random brains.
//   node --import tsx scripts/engine-compare.mjs [creatures=100] [ticks=300] [minGyration=0.3]
// For each engine it builds the same random bodies from examples/evolved-creatures and steps them, then reports how many were thrown
// (faster than 6 m/s, or the trunk rising more than a metre), the typical and worst speeds, and ticks per second. Run with a
// minGyration of 0 to see what each engine does with no help from the scene.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseScene, registerPhysicsEngine, Rng, Sim } from '../packages/core/src/index.ts'
import { loadMujoco } from '../packages/physics-mujoco/src/index.ts'

registerPhysicsEngine('mujoco', loadMujoco)
const N = Number(process.argv[2] ?? 100)
const TICKS = Number(process.argv[3] ?? 300)
const GYRATION = Number(process.argv[4] ?? 0.3)
const dir = new URL('../examples/evolved-creatures/', import.meta.url)
const parsed = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
const script = await import(pathToFileURL(new URL('creatures.js', dir).pathname).href)

const rng = new Rng(77)
const normal = () => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next())
const genomes = Array.from({ length: N }, () => script.randomGenome(() => rng.next(), normal))

for (const engine of ['rapier', 'mujoco']) {
  let thrown = 0, worst = 0, ms = 0, failed = 0
  const speeds = []
  for (const g of genomes) {
    const scene = structuredClone(parsed.scene)
    scene.entities[0].body = script.bodyOf(g)
    scene.data = { genome: g }
    scene.physics = { engine, minGyration: GYRATION }
    let sim
    try { sim = await Sim.create(scene, script) } catch (e) { failed++; continue }
    const stand = scene.entities[0].body.parts[0].position[1]
    let top = 0, rise = 0
    const t0 = performance.now()
    for (let t = 0; t < TICKS; t++) { sim.step(); const m = sim.metrics(); top = Math.max(top, m.speed); rise = Math.max(rise, m.y - stand) }
    ms += performance.now() - t0
    sim.dispose()
    if (!(top <= 6) || !(rise <= 1)) thrown++
    speeds.push(top); worst = Math.max(worst, top)
  }
  speeds.sort((a, b) => a - b)
  console.log(`${engine.padEnd(7)} thrown ${thrown}/${N}  median top speed ${speeds[speeds.length >> 1]?.toFixed(1)} m/s  worst ${worst.toFixed(1)} m/s  ${(N * TICKS / (ms / 1000)).toFixed(0)} ticks/s (${(ms / (N * TICKS)).toFixed(2)} ms/tick)${failed ? `  could not build ${failed}` : ''}  [minGyration ${GYRATION}]`)
}
