import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { expandBody, parseScene, validateBody, type BodyDef, type BodyInput } from '../src/index'

const flat = JSON.parse(readFileSync(new URL('./fixtures/creature-flat-body.json', import.meta.url), 'utf8')) as BodyDef
const scene = parseScene(readFileSync(new URL('../../../examples/creature/scene.json', import.meta.url), 'utf8'))
assert.ok(scene.ok, scene.ok ? '' : scene.errors.join('\n'))
const defaults = Object.fromEntries(Object.entries(scene.ok ? scene.scene.params : {}).map(([k, v]) => [k, typeof v === 'number' ? v : v.value]))
const built = validateBody(scene.ok ? scene.scene.entities[0].body : null, defaults)
assert.ok(built.ok)
const expanded = (built.ok ? built.body : null) as BodyDef

// the old hand-written names, from the new template names: "FL.upper" was "upperFL", "FL.hip" was "hipFL"
const oldName = (n: string) => { const [leg, part] = n.split('.'); return part ? part + leg : n }

test('one leg template attached four times builds the same body as the long hand-written version', () => {
  assert.equal(expanded.parts.length, flat.parts.length)
  assert.equal(expanded.joints!.length, flat.joints!.length)
  expanded.parts.forEach((p, i) => {
    const f = flat.parts[i]
    assert.equal(oldName(p.name), f.name)
    assert.deepEqual({ ...p, name: f.name }, f, `part ${f.name}`)
  })
  expanded.joints!.forEach((j, i) => {
    const f = flat.joints![i]
    assert.equal(oldName(j.name), f.name)
    assert.equal(oldName(j.parent), f.parent)
    assert.equal(oldName(j.child), f.child)
    assert.deepEqual({ ...j, name: f.name, parent: f.parent, child: f.child }, f, `joint ${f.name}`)
  })
  assert.deepEqual(expanded.sensors, flat.sensors)
})

test('a template can be attached turned about the vertical axis', () => {
  const body: BodyInput = {
    parts: [{ name: 'trunk', shape: 'box', size: [1, 1, 1], mass: 1, position: [0, 1, 0] }],
    templates: { arm: { parts: [{ name: 'a', shape: 'box', size: [1, 1, 1], mass: 1, position: [1, 0, 0] }], joints: [{ name: 'j', type: 'fixed', parent: '^', child: 'a', anchor: [0, 0, 0] }] } },
    attach: [{ template: 'arm', name: 'side', at: [0, 0, 0], yaw: Math.PI / 2 }],
  }
  const r = validateBody(body)
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  // turning +x by 90 degrees points it toward -z, the same convention the engine uses for creature headings
  assert.ok(Math.abs(r.ok ? r.body.parts[1].position[2] + 1 : 1) < 1e-9)
})

test('mistakes in templates are reported where they were made', () => {
  const base: BodyInput = { parts: [{ name: 'torso', shape: 'box', size: [1, 1, 1], mass: 1, position: [0, 1, 0] }] }
  assert.match(expandBody({ ...base, attach: [{ template: 'nope', name: 'x' }] }, 'body').errors.join(), /attach\.0\.template: unknown template "nope"/)
  const needsArg: BodyInput = {
    ...base,
    templates: { t: { parts: [{ name: 'p', shape: 'box', size: [1, 1, 1], mass: 1, position: [0, 0, 0] }], joints: [{ name: 'j', parent: '^', child: 'p', anchor: [0, 0, 0], drive: { phase: '@phase' } }] } },
    attach: [{ template: 't', name: 'x' }],
  }
  assert.match(expandBody(needsArg, 'body').errors.join(), /needs a value for "phase"/)
  assert.match(expandBody({ ...base, attach: [{ template: 'nope', name: 'x', to: 'ghost' }] }, 'body').errors.join(), /unknown/)
})

test('a drive without its own motor gets the body default, and a plain body passes through unchanged', () => {
  const body: BodyInput = {
    motor: { stiffness: 50 },
    parts: [{ name: 'a', shape: 'box', size: [1, 1, 1], mass: 1, position: [0, 1, 0] }, { name: 'b', shape: 'box', size: [1, 1, 1], mass: 1, position: [1, 1, 0] }],
    joints: [{ name: 'j', parent: 'a', child: 'b', anchor: [0.5, 1, 0], drive: { amplitude: 0.3 } }],
  }
  const r = validateBody(body)
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  assert.deepEqual(r.ok ? r.body.joints![0].motor : null, { stiffness: 50 })
})

test('geometry can be arithmetic on params, and the creature is rebuilt when a param changes', async () => {
  const { Sim } = await import('../src/index')
  const raw = JSON.parse(readFileSync(new URL('../../../examples/creature/scene.json', import.meta.url), 'utf8'))
  raw.params.legLength = { value: 0.5, min: 0.2, max: 0.9 }
  const tpl = raw.entities[0].body.templates.leg
  tpl.parts[0].size = ['$legLength / 2', 0.06]
  tpl.parts[0].position = [0, '-$legLength / 4', 0]
  const r = parseScene(JSON.stringify(raw))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  const tall = validateBody(raw.entities[0].body, { ...defaults, legLength: 0.9 })
  const short = validateBody(raw.entities[0].body, { ...defaults, legLength: 0.2 })
  assert.ok(tall.ok && short.ok)
  assert.equal(tall.ok && tall.body.parts.find((p) => p.name === 'FL.upper')!.size[0], 0.45)
  assert.equal(short.ok && short.body.parts.find((p) => p.name === 'FL.upper')!.size[0], 0.1)
  // an unknown param in an expression is reported where it was written
  const bad = validateBody({ ...raw.entities[0].body, parts: [{ ...raw.entities[0].body.parts[0], mass: '$nope * 2' }] }, { ...defaults, legLength: 0.5 })
  assert.equal(bad.ok, false)
  assert.match(bad.ok ? '' : bad.errors.join('\n'), /unknown param "\$nope"/)
  // live: editing the param on a running sim rebuilds the creatures
  raw.params.count = 2
  const scene = parseScene(JSON.stringify(raw))
  assert.ok(scene.ok)
  const sim = await Sim.create(scene.ok ? scene.scene : (null as never))
  for (let i = 0; i < 20; i++) sim.step()
  const before = sim.hash()
  const next = structuredClone(scene.ok ? scene.scene : (null as never))
  next.params.legLength = { value: 0.8, min: 0.2, max: 0.9 }
  sim.setScene(next)
  for (let i = 0; i < 5; i++) sim.step()
  assert.equal(sim.takeErrors().length, 0)
  assert.notEqual(sim.hash(), before)
  sim.dispose()
})
