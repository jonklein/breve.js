import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseScene, validateBody, type BodyDef } from '../src/index'

const sceneText = readFileSync(new URL('../../../examples/creature/scene.json', import.meta.url), 'utf8')
const example = () => JSON.parse(sceneText)
// the scene file may use templates; the engine (and these tests) work with the flat, expanded body
const body = () => {
  const r = validateBody(example().entities[0].body)
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return structuredClone(r.ok ? r.body : (null as never)) as BodyDef
}

const small = (): BodyDef => ({
  parts: [
    { name: 'torso', shape: 'box', size: [1, 0.2, 0.5], mass: 2, position: [0, 1, 0] },
    { name: 'arm', shape: 'capsule', size: [0.4, 0.05], mass: 0.2, position: [0.7, 1, 0] },
  ],
  joints: [{ name: 'shoulder', parent: 'torso', child: 'arm', anchor: [0.5, 1, 0], axis: [0, 0, 1], limits: [-1, 1], motor: { stiffness: 50, damping: 4 }, drive: { amplitude: 0.5, phase: 0.25 } }],
})

const errors = (b: unknown): string => {
  const r = validateBody(b)
  assert.equal(r.ok, false)
  return r.ok ? '' : r.errors.join('\n')
}

test('the example scene and its walker body are valid', () => {
  const r = parseScene(sceneText)
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  const b = body()
  assert.equal(b.parts.length, 9)
  assert.equal(b.joints!.length, 8)
  assert.deepEqual(validateBody(small()).ok, true)
})

test('a body without parts, or with unknown properties, is rejected with readable errors', () => {
  assert.match(errors({}), /body: missing "parts"/)
  const b = small() as unknown as { parts: Record<string, unknown>[] }
  b.parts[0].wings = 2
  assert.match(errors(b), /body\.parts\.0: unknown property "wings"/)
})

test('part sizes must fit the shape and be positive', () => {
  const b = small()
  b.parts[1].size = [0.4]
  assert.match(errors(b), /parts\.1\.size: a capsule needs 2 numbers, got 1/)
  b.parts[1].size = [0.4, -1]
  assert.match(errors(b), /parts\.1\.size/)
  const c = small()
  c.parts[0].mass = 0
  assert.match(errors(c), /parts\.0\.mass/)
})

test('joints must name real parts and form a tree under the first part', () => {
  const b = small()
  b.joints![0].child = 'tail'
  assert.match(errors(b), /joints\.0\.child: unknown part "tail"/)

  const loose = small()
  loose.joints = []
  assert.match(errors(loose), /"arm" is not connected to the root part "torso"/)

  const twice = small()
  twice.parts.push({ name: 'hand', shape: 'sphere', size: [0.05], mass: 0.1, position: [1, 1, 0] })
  twice.joints!.push({ name: 'wrist', parent: 'arm', child: 'hand', anchor: [0.9, 1, 0] }, { name: 'wrist2', parent: 'torso', child: 'hand', anchor: [0.9, 1, 0] })
  assert.match(errors(twice), /part "hand" already hangs off another joint/)

  const cycle = small()
  cycle.joints![0].child = 'torso'
  assert.match(errors(cycle), /root part "torso" cannot be a child/)

  const dup = small()
  dup.parts[1].name = 'torso'
  assert.match(errors(dup), /duplicate part name "torso"/)
})

test('joint details: limits order, zero axis, motors only on hinges, drives get a default motor', () => {
  const a = small()
  a.joints![0].limits = [1, -1]
  assert.match(errors(a), /joints\.0\.limits: the first number must be less than the second/)
  const b = small()
  b.joints![0].axis = [0, 0, 0]
  assert.match(errors(b), /axis: must not be all zeros/)
  const c = small()
  c.joints![0].type = 'ball'
  assert.match(errors(c), /only hinge joints have "motor"/)
  const d = small()
  delete d.joints![0].motor
  assert.equal(validateBody(d).ok, true, 'a drive without its own motor uses the default one')
})

test('inside a scene, drives and motors may only name params that exist', () => {
  const s = example()
  s.entities[0].body.templates.leg.joints[0].drive.amplitude = '$nope'
  const r = parseScene(JSON.stringify(s))
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.errors.join('\n'), /entities\.0\.body\.joints\.0\.drive\.amplitude: unknown param "\$nope"/)

  const t = example()
  t.entities[0].oscillator = { frequency: '$missing' }
  assert.match(String((parseScene(JSON.stringify(t)) as { errors?: string[] }).errors), /oscillator\.frequency: unknown param "\$missing"/)
})

test('scene-level terrain and physics are validated too', () => {
  const s = example()
  s.terrain.resolution = 1
  s.terrain.bumpy = true
  s.physics = { substeps: 0 }
  const r = parseScene(JSON.stringify(s))
  assert.equal(r.ok, false)
  const msg = r.ok ? '' : r.errors.join('\n')
  assert.match(msg, /terrain\.resolution/)
  assert.match(msg, /terrain: unknown property "bumpy"/)
  assert.match(msg, /physics\.substeps/)
})

test('a lattice cannot have a body', () => {
  const s = example()
  s.entities[0].lattice = { size: [3, 3, 3] }
  delete s.entities[0].count
  const r = parseScene(JSON.stringify(s))
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.errors.join('\n'), /a lattice cannot have a body/)
})

test('the creature snippet in docs/script-api.md is a valid scene (once it has a seed and params)', () => {
  const doc = readFileSync(new URL('../../../docs/script-api.md', import.meta.url), 'utf8')
  const block = doc.slice(doc.indexOf('### Entity set: creatures')).match(/```jsonc\n([\s\S]*?)```/)![1]
  const snippet = JSON.parse(block.replace(/\s\/\/.*$/gm, ''))
  const params = Object.fromEntries(['count', 'frequency', 'strength', 'stride', 'lift', 'kneeLag', 'diagonal', 'hindOffset'].map((k) => [k, 1]))
  const r = parseScene(JSON.stringify({ seed: 1, params, ...snippet }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
})
