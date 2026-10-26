import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, importMjcf, parseScene } from '../src/index'

const MODEL = `<mujoco model="hopper">
  <compiler angle="degree"/>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 .1"/>
    <body name="torso" pos="0 0 1">
      <freejoint/>
      <geom type="box" size="0.3 0.15 0.1" mass="4"/>
      <body name="thigh" pos="0 0 -0.1">
        <joint name="hip" type="hinge" axis="0 1 0" range="-45 45"/>
        <geom type="capsule" fromto="0 0 0 0 0 -0.4" size="0.05" mass="1"/>
        <body name="shin" pos="0 0 -0.4">
          <joint name="knee" type="hinge" axis="0 1 0" range="0 90" pos="0 0 0"/>
          <geom type="cylinder" size="0.04 0.2" pos="0 0 -0.2" mass="0.5"/>
        </body>
      </body>
    </body>
  </worldbody>
</mujoco>`

test('MJCF: bodies, geoms and hinges come out as a y-up body that validates', () => {
  const r = importMjcf(MODEL)
  assert.deepEqual(r.errors, [])
  assert.ok(r.warnings.some((w) => /floor/.test(w)), 'the floor geom is reported as left out')
  const [torso, thigh, shin] = r.body.parts
  assert.equal(torso.name, 'torso')
  assert.deepEqual(torso.size, [0.6, 0.2, 0.3], 'half sizes (0.3, 0.15, 0.1) become full width/height/depth with y and z swapped')
  assert.equal(thigh.shape, 'capsule')
  assert.deepEqual(thigh.size, [0.4, 0.05], 'fromto sets the length, the size the radius')
  assert.equal(shin.shape, 'cylinder')
  assert.ok(thigh.position[1] > shin.position[1] && torso.position[1] > thigh.position[1], 'legs hang below the torso')
  // thigh is 0.1 below the torso center, centered 0.2 down its own length
  assert.ok(Math.abs(torso.position[1] - thigh.position[1] - 0.3) < 1e-4)
  const [hip, knee] = r.body.joints!
  assert.deepEqual([hip.type, hip.parent, hip.child], ['hinge', 'torso', 'thigh'])
  assert.deepEqual(hip.axis!.map((v) => Math.round(v)), [0, 0, -1], 'MJCF y axis becomes -z when y-up')
  assert.ok(Math.abs(hip.limits![1] - Math.PI / 4) < 1e-5, 'degrees become radians')
  assert.ok(Math.abs(knee.limits![1] - Math.PI / 2) < 1e-5)
  // the whole thing is a valid scene
  const parsed = parseScene(JSON.stringify({ seed: 1, params: {}, bounds: { size: 20 }, terrain: { size: 20, amplitude: 0 }, entities: [{ name: 'hopper', count: 1, body: r.body }], metrics: [] }))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n'))
})

test('MJCF: a lowest point rests just above the ground, and the model holds together under physics', async () => {
  const r = importMjcf(MODEL)
  const parsed = parseScene(JSON.stringify({ seed: 1, params: {}, bounds: { size: 20 }, terrain: { size: 20, amplitude: 0 }, entities: [{ name: 'hopper', count: 1, body: r.body }], metrics: [] }))
  assert.ok(parsed.ok)
  const sim = await Sim.create(parsed.scene, { default: { decide: () => ({}) } })
  for (let i = 0; i < 180; i++) sim.step()
  assert.equal(sim.takeErrors().length, 0)
  const py = (sim.table.cols as unknown as Record<string, Float64Array>).py[0]
  assert.ok(Number.isFinite(py) && py > 0.1 && py < 1.2, `torso stays together at ${py}`)
  sim.dispose()
})

test('MJCF: unsupported things are reported plainly', () => {
  const bad = importMjcf(`<mujoco><worldbody><body name="a"><geom type="mesh" mesh="m"/><body name="b"><joint type="slide"/><joint type="hinge"/><geom type="sphere" size="0.1"/></body></body></worldbody></mujoco>`)
  const msg = bad.errors.join('\n')
  assert.match(msg, /type="mesh"\> is not supported|mesh/)
  assert.match(msg, /2 joints on one body/)
  assert.match(importMjcf('<x/>').errors.join(), /no <mujoco>/)
  assert.match(importMjcf('<mujoco><worldbody/></mujoco>').errors.join(), /no <body>/)
})

test('MJCF: quaternion and axis-angle orientations agree with euler', () => {
  const at = (attr: string) => importMjcf(`<mujoco><worldbody><body name="a"><geom type="box" size="0.5 0.1 0.1" ${attr}/></body></worldbody></mujoco>`).body.parts[0].rotation
  const e = at('euler="0 0 90"')!, q = at(`quat="${Math.SQRT1_2} 0 0 ${Math.SQRT1_2}"`)!, a = at('axisangle="0 0 1 90"')!
  for (let i = 0; i < 3; i++) { assert.ok(Math.abs(e[i] - q[i]) < 1e-4, `${e} vs ${q}`); assert.ok(Math.abs(e[i] - a[i]) < 1e-4, `${e} vs ${a}`) }
})
