import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { cpuFormulaBackend } from '@breve/stdlib'
import { Sim, parseScene, registerFormulaBackend, GpuLatticeWorld, type ScriptModule } from '../src/index'

// A lattice kept "on a card" is tested with the interpreter standing in for the card: it holds the state apart from the columns and gives
// pictures and totals on request, exactly as the interface says, so this checks everything the sim does around it.
const sceneOf = (size: [number, number, number]) => {
  const p = parseScene(readFileSync(new URL('../../../examples/life2d-formula/scene.json', import.meta.url), 'utf8'))
  assert.ok(p.ok)
  p.scene.entities[0].lattice!.size = size
  p.scene.metrics = ['population']
  return p.scene
}
const script = async () => (await import(pathToFileURL(new URL('../../../examples/life2d-formula/life.js', import.meta.url).pathname).href)) as ScriptModule
const cols = (sim: Sim) => (sim.snapshot().worlds[0] as { table: { cols: Record<string, Float32Array> } }).table.cols

test.before(() => registerFormulaBackend(async () => cpuFormulaBackend))
test.after(() => registerFormulaBackend(async () => null))

test('with a backend registered, a formula lattice keeps its cells on the card and gives the same cells as the processor', async () => {
  const scene = sceneOf([40, 30, 1])
  const card = await Sim.create(structuredClone(scene), await script())
  assert.ok(card.worlds[0] instanceof GpuLatticeWorld)
  assert.ok(card.onGraphicsCard)
  const cpu = new Sim(structuredClone(scene), await script()) // `new Sim` has no backend: the processor's own lattice
  assert.ok(!(cpu.worlds[0] instanceof GpuLatticeWorld))
  for (let t = 1; t <= 25; t++) {
    card.step(); cpu.step()
    if (t % 5 === 0) {
      await card.sync()
      const a = card.snapshot().worlds[0] as { state: Record<string, Float32Array> }
      assert.deepEqual(a.state.alive, cols(cpu).alive.slice(0, 1200), `alive differs at tick ${t}`)
      assert.deepEqual(a.state.age, cols(cpu).age.slice(0, 1200), `age differs at tick ${t}`)
    }
  }
  assert.equal(card.takeErrors().length, 0)
})

test('frames are a picture, metrics are totals, and both come from refresh', async () => {
  const sim = await Sim.create(sceneOf([32, 24, 1]), await script())
  for (let t = 0; t < 6; t++) sim.step()
  assert.ok(sim.needsRefresh)
  await sim.refresh()
  assert.ok(!sim.needsRefresh)
  const f = sim.frames()[0]
  assert.equal(f.kind, 'field')
  assert.equal(f.field!.width, 32)
  assert.equal(f.field!.height, 24)
  assert.equal(f.field!.pixels.length, 32 * 24 * 4)
  await sim.sync()
  const alive = (sim.snapshot().worlds[0] as { state: Record<string, Float32Array> }).state.alive
  assert.equal(sim.metrics().population, alive.reduce((s, v) => s + v, 0), 'the metric is the total worked out on the card')
  // dead cells show the background, living ones a color
  const px = f.field!.pixels
  for (let c = 0; c < 32 * 24; c++) assert.equal(px[c * 4 + 2] === 15 && px[c * 4] === 5, !alive[c], `cell ${c}`)
})

test('zooming only changes the window: the same grid drawn bigger', async () => {
  const sim = await Sim.create(sceneOf([32, 24, 1]), await script())
  sim.step()
  sim.setFieldView(0, { window: [8, 6, 16, 12], width: 32, height: 24 })
  await sim.refresh()
  const f = sim.frames()[0].field!
  assert.deepEqual(f.window, [8, 6, 16, 12])
  assert.equal(f.pixels.length, 32 * 24 * 4)
  await sim.sync()
  const alive = (sim.snapshot().worlds[0] as { state: Record<string, Float32Array> }).state.alive
  // each cell of the window is a 4 x 4 block of pixels
  for (let py = 0; py < 24; py++) for (let pxl = 0; pxl < 32; pxl++) {
    const c = (6 + Math.floor(py / 4)) * 32 + 8 + Math.floor(pxl / 4)
    assert.equal(f.pixels[(py * 32 + pxl) * 4 + 2] === 15, !alive[c])
  }
})

test('snapshot, hash and fork need the state back first, and then work', async () => {
  const sim = await Sim.create(sceneOf([24, 24, 1]), await script())
  for (let t = 0; t < 8; t++) sim.step()
  assert.throws(() => sim.snapshot(), /await sim\.sync\(\)/)
  assert.throws(() => sim.hash(), /await sim\.sync\(\)/)
  await sim.sync()
  const h = sim.hash()
  assert.equal(sim.hash(), h)
  const fork = await Sim.create(sim.scene, await script())
  fork.restore(sim.snapshot())
  for (let t = 0; t < 10; t++) { sim.step(); fork.step() }
  await Promise.all([sim.sync(), fork.sync()])
  assert.equal(fork.hash(), sim.hash(), 'a restored copy keeps in step')
  sim.step()
  assert.throws(() => sim.hash(), /await sim\.sync\(\)/, 'after another step the state is not back yet')
})

test('compute "cpu" keeps a formula lattice on the processor even when a backend exists', async () => {
  const scene = sceneOf([16, 16, 1])
  scene.entities[0].lattice!.compute = 'cpu'
  const sim = await Sim.create(scene, await script())
  assert.ok(!(sim.worlds[0] instanceof GpuLatticeWorld))
  assert.ok(!sim.onGraphicsCard)
})

test('a rule that only adds and compares whole numbers is repeatable on any card; one that divides is flagged', async () => {
  const sim = await Sim.create(sceneOf([8, 8, 1]), await script())
  assert.deepEqual(sim.nondeterministic(), [])
  const sloppy = await script()
  const flagged = await Sim.create(sceneOf([8, 8, 1]), { default: { ...sloppy.default, actFormula: ({ alive }: Record<string, any>) => ({ alive: alive.div(3).ne(0) }) } } as ScriptModule)
  assert.deepEqual(flagged.nondeterministic(), ['cell'])
})

test('a 3D lattice on the card is drawn cell by cell, and gives the same cells as the processor', async () => {
  const p = parseScene(readFileSync(new URL('../../../examples/life3d-gpu/scene.json', import.meta.url), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  p.scene.entities[0].lattice!.size = [10, 10, 10]
  const js = (await import(pathToFileURL(new URL('../../../examples/life3d-gpu/life.js', import.meta.url).pathname).href)) as ScriptModule
  const card = await Sim.create(structuredClone(p.scene), js)
  assert.ok(card.worlds[0] instanceof GpuLatticeWorld)
  const cpu = new Sim(structuredClone(p.scene), js)
  for (let t = 1; t <= 12; t++) { card.step(); cpu.step() }
  await card.sync()
  const a = card.snapshot().worlds[0] as { state: Record<string, Float32Array> }
  assert.deepEqual(a.state.alive, cols(cpu).alive.slice(0, 1000), 'the cube matches the processor')
  await card.refresh()
  const f = card.frames()[0]
  assert.equal(f.kind, 'lattice')
  const live = a.state.alive.reduce((s, v) => s + v, 0)
  assert.equal(f.count, live, 'one cube per living cell')
  assert.equal(f.lattice!.show.length, 1000)
  assert.ok(f.lattice!.rgb && f.lattice!.rgb.length === 3000)
  assert.equal(card.takeErrors().length, 0)
})
