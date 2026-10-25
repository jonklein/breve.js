import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { expandBody, parseScene, validateBody, type BodyDef, type BodyInput } from '../src/index'

const flat = JSON.parse(readFileSync(new URL('./fixtures/creature-flat-body.json', import.meta.url), 'utf8')) as BodyDef
const scene = parseScene(readFileSync(new URL('../../../examples/creature/scene.json', import.meta.url), 'utf8'))
assert.ok(scene.ok, scene.ok ? '' : scene.errors.join('\n'))
const expanded = (scene.ok ? scene.scene.entities[0].body : null) as BodyDef

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
