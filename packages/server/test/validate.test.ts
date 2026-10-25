import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { problemsWith, checkScript } from '../src/validate'
import { systemPrompt, projectBlock } from '../src/prompt'

const ex = (f: string) => readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8')

test('the shipped examples pass the same validation the assistant output goes through', () => {
  assert.deepEqual(problemsWith({ scene: ex('boids/scene.json'), script: ex('boids/flock.js') }), [])
  assert.deepEqual(problemsWith({ scene: ex('life3d/scene.json'), script: ex('life3d/life.js') }), [])
  assert.deepEqual(problemsWith({ scene: ex('creature/scene.json'), script: ex('creature/creature.js') }), [])
})

test('bad scenes and scripts are reported in words the model can act on', () => {
  const scene = JSON.parse(ex('boids/scene.json'))
  scene.entities[0].count = '$nope'
  const p = problemsWith({ scene: JSON.stringify(scene), script: 'export default { decide( { }' })
  assert.ok(p.some((m) => /unknown param "\$nope"/.test(m)), p.join('\n'))
  assert.ok(p.some((m) => /syntax error/.test(m)), p.join('\n'))
})

test('a script without a default export is caught', () => {
  assert.match(problemsWith({ script: 'export const x = 1' }).join(), /export default/)
  assert.equal(checkScript('export default { decide() {} }'), null)
})

test('the system prompt carries the reference and both examples', () => {
  const s = systemPrompt()
  for (const needle of ['neighbors.velocity.average()', 'ctx.random()', '<example id="boids">', '<example id="life3d">', 'update_project']) assert.ok(s.includes(needle), needle)
})

test('the project block quotes both files', () => {
  const b = projectBlock({ name: 'x', scene: '{}', script: 'export default {}' })
  assert.ok(b.includes('<file name="scene.json">') && b.includes('export default {}'))
})
