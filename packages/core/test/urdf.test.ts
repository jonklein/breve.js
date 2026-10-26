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
  const rot = importUrdf('<robot name="r"><link name="a"><collision><geometry><box size="1 1 1"/></geometry></collision></link><link name="b"><collision><geometry><box size="1 1 1"/></geometry></collision></link><link name="c"><collision><geometry><mesh filename="x.stl"/></geometry></collision></link><joint name="j" type="prismatic"><parent link="a"/><child link="b"/><origin xyz="0 0 1" rpy="0 1.5 0"/></joint><joint name="k" type="fixed"><parent link="a"/><child link="c"/></joint></robot>')
  const msg = rot.errors.join('\n')
  assert.match(msg, /<mesh> shapes are not supported/)
  assert.match(msg, /"prismatic" joints are not supported/)
  assert.match(importUrdf('<notrobot/>').errors.join(), /no <robot>/)
  assert.match(importUrdf('<robot><link name="a">').errors.join(), /not valid XML/)
})

test('rotated frames (rpy) turn shapes, move child links and carry joint axes along', () => {
  const urdf = `<robot name="r">
    <link name="base"><collision><geometry><box size="1 1 1"/></geometry></collision></link>
    <link name="arm"><collision><origin xyz="0 0 0.5" rpy="0 0 0"/><geometry><cylinder radius="0.1" length="1"/></geometry></collision></link>
    <joint name="shoulder" type="revolute"><parent link="base"/><child link="arm"/><origin xyz="1 0 0" rpy="0 1.5707963 0"/><axis xyz="0 0 1"/><limit lower="-1" upper="1"/></joint>
  </robot>`
  const r = importUrdf(urdf)
  assert.deepEqual(r.errors, [])
  const [base, arm] = r.body.parts
  assert.equal(base.rotation, undefined, 'an unturned link has no rotation')
  // the arm frame is pitched +90deg: its local z (the cylinder axis) points along world +x, so the arm lies on the x axis
  assert.ok(arm.rotation, 'the pitched arm is rotated')
  const dx = arm.position[0] - 1, dy = arm.position[2]
  assert.ok(Math.abs(dx - 0.5) < 1e-4 && Math.abs(dy) < 1e-4, `arm center is half a meter out along x: ${arm.position}`)
  // the joint axis (local z) also points along world +x
  assert.deepEqual(r.body.joints![0].axis!.map((v) => Math.round(v)), [1, 0, 0])
  // the cylinder lies down, so it rests on its radius, not on half its length: the robot is lifted by the box (0.5), not by 0.5 of the arm
  assert.ok(Math.abs(base.position[1] - 0.52) < 1e-3, `lowest point is the box bottom: ${base.position}`)
  assert.equal(importUrdf(urdf.replace('1.5707963', '1.5707963 0 0').replace('rpy="0 1.5707963 0 0 0"', 'rpy="0 1.5707963 0"')).errors.length, 0)
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
