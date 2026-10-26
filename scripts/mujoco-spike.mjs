// Spike: the same walking creature in Rapier (what the product uses) and in MuJoCo WASM, compared on speed, determinism and gait.
//   npm install --no-save @mujoco/mujoco        (not a dependency of this repo)
//   node --import tsx scripts/mujoco-spike.mjs [creatures=20] [seconds=10]
// The body comes from examples/creature/scene.json. Both engines get the same body, the same motor gains (a torque of
// `stiffness` per radian of error, `damping` per radian/second) and the same oscillator targets; no script steers. Results are
// in docs/decisions/physics.md. This is a measurement, not a second engine in the product.
import { readFileSync } from 'node:fs'
import load_mujoco from '@mujoco/mujoco'
import { Sim, parseScene, paramValues, resolve } from '../packages/core/src/index.ts'
import { buildBody } from '../packages/core/src/body.ts'

const N = Number(process.argv[2] ?? 20)
const SECONDS = Number(process.argv[3] ?? 10)
const TICKS = Math.round(SECONDS * 60)
const SUBSTEPS = 4 // the product's default: four physics steps per 1/60 s tick

const parsed = parseScene(readFileSync(new URL('../examples/creature/scene.json', import.meta.url), 'utf8'))
if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
const scene = parsed.scene
scene.terrain = { size: 200, amplitude: 0 } // a flat floor for both
const params = paramValues(scene)
const def = scene.entities.find((e) => e.body)
const { body } = buildBody(def.body, params, 'body', null)
const TAU = Math.PI * 2
// the rhythm each leg joint follows (bodies no longer carry a drive: this is what examples/creature/creature.js asks of them)
const gaitFor = (name) => {
  const [leg, joint] = name.split('.')
  const phase = { FL: 0, FR: params.diagonal, HL: params.diagonal, HR: params.hindOffset }[leg]
  return joint === 'hip' ? { amplitude: params.stride, phase } : { amplitude: params.lift, offset: -0.9, phase, lag: params.kneeLag }
}
const freq = params.frequency ?? 1 // the example's step rate param

// ---- the same body as MJCF (our y-up becomes MuJoCo's z-up: (x, y, z) -> (x, -z, y)) ----
const up = ([x, y, z]) => [x, -z, y]
const f = (v) => v.map((n) => +n.toFixed(6)).join(' ')
const joints = body.joints ?? []
const driven = joints.filter((j) => j.motor && (j.type ?? 'hinge') === 'hinge')

function bodyXml(offset) {
  const parts = body.parts
  const kids = new Map(parts.map((p) => [p.name, []])), child = new Set()
  for (const j of joints) { kids.get(j.parent).push(j); child.add(j.child) }
  const byName = new Map(parts.map((p) => [p.name, p]))
  const root = parts.find((p) => !child.has(p.name))
  // creature parts are on collision layer 2 and only meet the floor (layer 1 asks for 2): no part touches another creature or itself, as in the product
  const geom = (p) => {
    const s = p.size
    const common = `mass="${p.mass}" friction="${p.friction ?? 1} 0.005 0.0001" contype="2" conaffinity="1"`
    if (p.shape === 'box') return `<geom type="box" size="${f([s[0] / 2, s[2] / 2, s[1] / 2])}" ${common}/>`
    if (p.shape === 'sphere') return `<geom type="sphere" size="${s[0]}" ${common}/>`
    return `<geom type="${p.shape}" size="${s[1]} ${s[0] / 2}" ${common}/>` // our long axis is y, which becomes z
  }
  const walk = (p, parent, jointIn) => {
    const rel = parent ? up(p.position.map((v, k) => v - parent.position[k])) : up(p.position).map((v, k) => v + offset[k])
    let j = ''
    if (!parent) j = '<joint type="free" damping="0.05"/>' // Rapier bodies carry linear damping 0.05 and angular 0.3; MuJoCo has none unless asked
    else if ((jointIn.type ?? 'hinge') === 'hinge') {
      const anchor = up(jointIn.anchor.map((v, k) => v - p.position[k]))
      j = `<joint name="${jointIn.name}" type="hinge" pos="${f(anchor)}" axis="${f(up(jointIn.axis ?? [0, 0, 1]))}"${jointIn.limits ? ` range="${f(jointIn.limits.map((r) => (r * 180) / Math.PI))}"` : ''} armature="0.001" damping="0.3"/>`
    }
    return `<body name="${p.name}" pos="${f(rel)}">${j}${geom(p)}${kids.get(p.name).map((jd) => walk(byName.get(jd.child), p, jd)).join('')}</body>`
  }
  return walk(root, null, null)
}

const actuators = driven.map((j) => `<position joint="${j.name}" kp="${resolve(j.motor.stiffness, params, 100)}" kv="${resolve(j.motor.damping, params, 8)}"/>`).join('')

const mujoco = await load_mujoco()
function mjRun() {
  const sims = []
  for (let i = 0; i < N; i++) { // one small world per creature: each is rooted by its own free joint
    const xml = `<mujoco><option timestep="${1 / 60 / SUBSTEPS}" integrator="implicitfast"/><worldbody><geom type="plane" size="200 200 .1" contype="1" conaffinity="2"/>`
      + `${bodyXml([(i % 5) * 3 - 6, Math.floor(i / 5) * 3 - 4, 0])}</worldbody><actuator>${actuators}</actuator></mujoco>`
    const model = mujoco.MjModel.from_xml_string(xml)
    sims.push({ model, data: new mujoco.MjData(model) })
  }
  const start = sims.map((s) => [s.data.qpos[0], s.data.qpos[1]])
  const t0 = performance.now()
  let phase = 0
  for (let t = 0; t < TICKS; t++) {
    for (const s of sims) {
      driven.forEach((j, k) => {
        const d = gaitFor(j.name)
        s.data.ctrl[k] = resolve(d.offset, params, 0) + resolve(d.amplitude, params, 0) * Math.sin(TAU * (phase + resolve(d.phase, params, 0) - resolve(d.lag, params, 0)))
      })
      for (let k = 0; k < SUBSTEPS; k++) mujoco.mj_step(s.model, s.data)
    }
    if (process.env.MJ_TRACE && t % 60 === 0) console.log('  t', (t / 60).toFixed(0), 's torso z', sims[0].data.qpos[2].toFixed(2), 'x', sims[0].data.qpos[0].toFixed(2))
    phase = (phase + freq / 60) % 1
  }
  const ms = performance.now() - t0
  const moved = sims.map((s, i) => Math.hypot(s.data.qpos[0] - start[i][0], s.data.qpos[1] - start[i][1]))
  const upright = sims.filter((s) => s.data.qpos[2] > 0.3).length // the torso is still up on its legs
  const hash = sims.reduce((h, s) => { for (let k = 0; k < s.model.nq; k++) h = Math.imul(h ^ Math.round(s.data.qpos[k] * 1e6), 16777619) >>> 0; return h }, 2166136261).toString(16)
  return { ms, moved, upright, hash }
}

// ---- Rapier: the product's own path, no steering script ----
async function rapierRun() {
  const s = structuredClone(scene)
  s.params.count = typeof s.params.count === 'number' ? N : { ...s.params.count, value: N }
  const sim = await Sim.create(s, { default: { act: () => ({}) }, Creature: { act: () => ({}) } })
  const c = sim.table.cols
  const start = Array.from({ length: N }, (_, i) => [c.px[i], c.pz[i]])
  const t0 = performance.now()
  for (let t = 0; t < TICKS; t++) sim.step()
  const ms = performance.now() - t0
  const moved = start.map((p, i) => Math.hypot(c.px[i] - p[0], c.pz[i] - p[1]))
  const upright = Array.from({ length: N }, (_, i) => c.py[i]).filter((y) => y > 0.3).length
  const hash = sim.hash()
  sim.dispose()
  return { ms, moved, upright, hash }
}

if (process.env.MJ_DEBUG) {
  // one creature, one second: is the model what we meant, and do the joints move?
  const model = mujoco.MjModel.from_xml_string(`<mujoco><option timestep="${1 / 60 / SUBSTEPS}" integrator="implicitfast"/><worldbody><geom type="plane" size="200 200 .1" contype="1" conaffinity="2"/>${bodyXml([0, 0, 0])}</worldbody><actuator>${actuators}</actuator></mujoco>`)
  const data = new mujoco.MjData(model)
  console.log('nq', model.nq, 'nv', model.nv, 'nu', model.nu, 'driven joints', driven.length, 'bodies', model.nbody)
  const show = () => console.log('  root', Array.from(data.qpos).slice(0, 3).map((v) => +v.toFixed(3)), 'joints', Array.from(data.qpos).slice(7, 12).map((v) => +v.toFixed(2)))
  show()
  for (let t = 0; t < 60 * SUBSTEPS; t++) { driven.forEach((_, k) => { data.ctrl[k] = 0.5 * Math.sin(t * 0.02) }); mujoco.mj_step(model, data); if (t % 60 === 59) show() }
  process.exit(0)
}

const stat = (r) => `${(TICKS / (r.ms / 1000)).toFixed(0)} ticks/s (${(r.ms / TICKS).toFixed(2)} ms/tick) · moved ${(r.moved.reduce((a, b) => a + b, 0) / N).toFixed(2)} m on average (min ${Math.min(...r.moved).toFixed(2)}, max ${Math.max(...r.moved).toFixed(2)}) · ${r.upright}/${N} upright · hash ${r.hash}`
console.log(`${N} creatures, ${SECONDS} s (${TICKS} ticks, ${SUBSTEPS} physics steps each), flat floor, no steering`)
const r1 = await rapierRun(); console.log('rapier  ', stat(r1))
const r2 = await rapierRun(); console.log('rapier 2', stat(r2), r1.hash === r2.hash ? '(same hash: repeatable)' : '(DIFFERENT hash)')
const m1 = mjRun(); console.log('mujoco  ', stat(m1))
const m2 = mjRun(); console.log('mujoco 2', stat(m2), m1.hash === m2.hash ? '(same hash: repeatable)' : '(DIFFERENT hash)')
