import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule } from '../src/index'

async function load(name: string, script: string) {
  const dir = new URL(`../../../examples/${name}/`, import.meta.url)
  const parsed = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n'))
  const mod = (await import(pathToFileURL(new URL(script, dir).pathname).href)) as ScriptModule
  return { scene: parsed.ok ? parsed.scene : (null as never), script: mod }
}

for (const [name, script] of [['boids', 'flock.js'], ['life3d', 'life.js']]) {
  test(`${name}: a fork carries on exactly like the original`, async () => {
    const { scene, script: mod } = await load(name, script)
    const a = new Sim(scene, mod)
    for (let i = 0; i < 40; i++) a.step()
    const b = a.fork()
    assert.equal(a.hash(), b.hash(), 'identical at the moment of the fork')
    for (let i = 0; i < 60; i++) { a.step(); b.step() }
    assert.equal(a.hash(), b.hash(), 'identical after both advance')
  })

  test(`${name}: restoring a snapshot replays the same future`, async () => {
    const { scene, script: mod } = await load(name, script)
    const a = new Sim(scene, mod)
    for (let i = 0; i < 20; i++) a.step()
    const snap = a.snapshot()
    for (let i = 0; i < 50; i++) a.step()
    const later = a.hash()
    a.restore(snap)
    for (let i = 0; i < 50; i++) a.step()
    assert.equal(a.hash(), later)
  })
}

test('branches are independent: changing one does not touch the other', async () => {
  const { scene, script } = await load('boids', 'flock.js')
  const a = new Sim(scene, script)
  for (let i = 0; i < 10; i++) a.step()
  const before = a.hash()
  const edited = structuredClone(scene)
  edited.params.separation = 0
  const b = a.fork(edited)
  for (let i = 0; i < 100; i++) b.step()
  assert.equal(a.hash(), before, 'stepping the fork leaves the original alone')
  for (let i = 0; i < 100; i++) a.step()
  assert.notEqual(a.hash(), b.hash(), 'a different param gives a different future')
})

test('a fork of a sim whose agents were added keeps ids working', async () => {
  const { scene, script } = await load('boids', 'flock.js')
  const a = new Sim(scene, script)
  a.step()
  const more = structuredClone(scene)
  more.params.count = 340
  a.setScene(more)
  const b = a.fork()
  assert.equal(b.table.size, a.table.size)
  assert.equal(b.table.idAt(5), a.table.idAt(5))
})
