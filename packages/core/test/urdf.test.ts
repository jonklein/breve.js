import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, importUrdf, parseScene, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/urdf-bot/', import.meta.url)

test('the example scene carries exactly what the importer makes from robot.urdf', () => {
  const r = importUrdf(readFileSync(new URL('robot.urdf', dir), 'utf8'))
  assert.deepEqual(r.errors, [])
  const scene = JSON.parse(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.deepEqual(scene.entities[0].body, r.body, 'run `npm run urdf -- examples/urdf-bot/robot.urdf` and paste it into scene.json')
  assert.equal(r.body.parts.length, 9)
  assert.equal(r.body.joints!.length, 8)
  assert.deepEqual(r.body.joints![0].axis, [0, 0, 1], 'URDF z-up becomes y-up: axis (0,-1,0) turns into (0,0,1)')
})

test('unsupported things are reported plainly', () => {
  const rot = importUrdf('<robot name="r"><link name="a"><collision><geometry><box size="1 1 1"/></geometry></collision></link><link name="b"><collision><geometry><box size="1 1 1"/></geometry></collision></link><link name="c"><collision><geometry><mesh filename="x.stl"/></geometry></collision></link><joint name="j" type="prismatic"><parent link="a"/><child link="b"/><origin xyz="0 0 1" rpy="0 1.5 0"/></joint></robot>')
  const msg = rot.errors.join('\n')
  assert.match(msg, /rotated frames/)
  assert.match(msg, /<mesh> shapes are not supported/)
  assert.match(msg, /"prismatic" joints are not supported/)
  assert.match(importUrdf('<notrobot/>').errors.join(), /no <robot>/)
  assert.match(importUrdf('<robot><link name="a">').errors.join(), /not valid XML/)
})

test('the imported robot stands up and walks without falling over', async () => {
  const parsed = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('urdf-bot.js', dir).pathname).href)) as ScriptModule
  const scene = parsed.ok ? parsed.scene : (null as never)
  scene.params.count = 2
  scene.terrain = { size: 60, amplitude: 0 }
  const sim = await Sim.create(scene, script)
  const c = sim.table.cols as unknown as Record<string, Float64Array>
  for (let i = 0; i < 360; i++) sim.step()
  assert.equal(sim.takeErrors().length, 0, sim.takeErrors().join('\n'))
  assert.ok(c.py[0] > 0.25 && c.py[1] > 0.25, `still on its feet: torso at ${c.py[0].toFixed(2)}`)
  assert.ok(sim.metrics().distance > 0.5, `walked ${sim.metrics().distance}`)
  sim.dispose()
})
