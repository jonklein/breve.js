// Evolved creatures, after Karl Sims (1994): bodies and brains that evolve together.
//
// Three things live in this file:
//
//   the creature   a controller. Its body and brain come from the scene's `data.genome`, so the same
//                  script drives any creature a genome describes.
//   the genome     plain data: torso size, up to three mirrored pairs of limbs (each one to three
//                  segments with a length, a thickness and a hinge direction), and the weights of a
//                  small neural network. `bodyOf` turns it into the scene's body.
//   the parent     a program that runs a whole population as sub-simulations, one creature each, side by
//                  side. At the end of a generation it ranks them by how far they walked, keeps the best,
//                  and breeds the rest. Evolution is written here, not in the engine.
//
// Try: raise "mutation strength" for wilder offspring, lower "survivors kept" for stronger selection, and
// click a tile to watch one creature on its own.

const PAIRS = 3 // limb pairs a body can grow
const SEGS = 3 // segments in a limb
const SLOTS = PAIRS * 2 * SEGS // every joint a body could have
const SIZES = [SLOTS + PAIRS * 2 + 5, 10, SLOTS] // brain: joint angles, touch, which way is up, a clock -> joint targets
const WEIGHTS = SIZES.slice(1).reduce((n, out, i) => n + (SIZES[i] + 1) * out, 0)
const SWING = 1.2 // radians a joint can turn either way
const SETTLE = 90 // ticks a creature gets to land before its walk is measured

const slot = (pair, side, seg) => pair * 6 + side * 3 + seg
const sideName = ['L', 'R']

// ---------------------------------------------------------------------------------------------------------
// The creature

export default {
  act({ self }, p, ctx) {
    const g = ctx.data.genome
    if (!g) return
    const x = new Float64Array(SIZES[0])
    const joints = self.joints
    const live = [] // [joint name, slot] for each joint this body has
    g.pairs.forEach((pair, i) => {
      if (!pair.on) return
      for (let side = 0; side < 2; side++) {
        for (let k = 0; k < pair.segs.length; k++) {
          const name = `J${i}${sideName[side]}${k}`
          x[slot(i, side, k)] = (joints[name] ?? 0) / SWING
          live.push([name, slot(i, side, k)])
        }
        const foot = `S${i}${sideName[side]}${pair.segs.length - 1}`
        x[SLOTS + i * 2 + side] = self.touch[foot] ? 1 : 0
      }
    })
    const up = self.up
    x[SLOTS + PAIRS * 2] = up.x
    x[SLOTS + PAIRS * 2 + 1] = up.y
    x[SLOTS + PAIRS * 2 + 2] = up.z
    const phase = 2 * Math.PI * g.rhythm * ctx.tick * ctx.dt
    x[SLOTS + PAIRS * 2 + 3] = Math.sin(phase)
    x[SLOTS + PAIRS * 2 + 4] = Math.cos(phase)

    const out = ctx.mlp(SIZES).run(g.weights, x)
    const targets = {}
    for (const [name, s] of live) targets[name] = SWING * Math.tanh(out[s])
    return { joints: targets }
  },
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export const metrics = {
  // where the creature is: a parent measures how far it got between two moments
  x: ({ creatures }) => mean(creatures.map((c) => c.x)),
  z: ({ creatures }) => mean(creatures.map((c) => c.z)),
  // 1 standing, 0 on its side, -1 upside down
  upright: ({ creatures }) => mean(creatures.map((c) => c.up.y)),
}

// ---------------------------------------------------------------------------------------------------------
// The genome

const RANGE = { length: [0.5, 1.6], width: [0.3, 0.8], height: [0.12, 0.4], at: [-0.35, 0.35], len: [0.12, 0.55], rad: [0.03, 0.09], rhythm: [0.4, 3] }
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))
const between = (r, [lo, hi]) => lo + r() * (hi - lo)

function randomSegment(r) {
  return { len: between(r, RANGE.len), rad: between(r, RANGE.rad), axis: r() < 0.7 ? 0 : 1 }
}

function randomPair(r, on) {
  return { on, at: between(r, RANGE.at), segs: Array.from({ length: 1 + Math.floor(r() * SEGS) }, () => randomSegment(r)) }
}

export function randomGenome(r, normal) {
  return {
    torso: { length: between(r, RANGE.length), width: between(r, RANGE.width), height: between(r, RANGE.height) },
    pairs: Array.from({ length: PAIRS }, (_, i) => randomPair(r, i === 0 || r() < 0.5)),
    rhythm: between(r, RANGE.rhythm),
    weights: Array.from({ length: WEIGHTS }, () => 0.6 * normal()),
  }
}

/** A child: each part of the body from either parent, each weight from either parent. */
export function crossover(a, b, r) {
  const pick = (x, y) => (r() < 0.5 ? x : y)
  return structuredClone({
    torso: { length: pick(a.torso.length, b.torso.length), width: pick(a.torso.width, b.torso.width), height: pick(a.torso.height, b.torso.height) },
    pairs: a.pairs.map((pa, i) => pick(pa, b.pairs[i])),
    rhythm: pick(a.rhythm, b.rhythm),
    weights: a.weights.map((w, i) => pick(w, b.weights[i])),
  })
}

/** A copy with some genes nudged. `strength` 0..1 scales how many change and by how much. */
export function mutate(g, strength, r, normal) {
  const c = structuredClone(g)
  const nudge = (v, range) => clamp(v + normal() * 0.15 * strength * (range[1] - range[0]), range)
  const chance = (p) => r() < p * strength
  for (const k of ['length', 'width', 'height']) if (chance(0.5)) c.torso[k] = nudge(c.torso[k], RANGE[k])
  if (chance(0.5)) c.rhythm = nudge(c.rhythm, RANGE.rhythm)
  c.pairs.forEach((pair, i) => {
    if (i > 0 && chance(0.1)) pair.on = !pair.on
    if (chance(0.4)) pair.at = nudge(pair.at, RANGE.at)
    for (const seg of pair.segs) {
      if (chance(0.5)) seg.len = nudge(seg.len, RANGE.len)
      if (chance(0.5)) seg.rad = nudge(seg.rad, RANGE.rad)
      if (chance(0.08)) seg.axis = 1 - seg.axis
    }
    if (chance(0.15)) {
      if (pair.segs.length < SEGS && r() < 0.5) pair.segs.push(randomSegment(r))
      else if (pair.segs.length > 1) pair.segs.pop()
    }
  })
  for (let i = 0; i < c.weights.length; i++) if (r() < 0.12 * Math.max(strength, 0.05)) c.weights[i] += normal() * 0.5 * strength
  return c
}

/** The scene's body for a genome: a box torso, and for each pair of limbs a chain of capsules on a hinge each side. */
export function bodyOf(g) {
  const { length, width, height } = g.torso
  const reach = Math.max(0, ...g.pairs.filter((p) => p.on).map((p) => p.segs.reduce((n, s) => n + s.len, 0) + p.segs[p.segs.length - 1].rad))
  const top = reach + height / 2 + 0.03 // the torso's middle, so the longest limb just reaches the ground
  const parts = [{ name: 'torso', shape: 'box', size: [length, height, width], mass: Math.max(0.5, 40 * length * height * width), position: [0, top, 0], color: '#d9a441' }]
  const joints = []
  g.pairs.forEach((pair, i) => {
    if (!pair.on) return
    for (let side = 0; side < 2; side++) {
      const z = (side ? 1 : -1) * (width / 2 + pair.segs[0].rad)
      let hang = top - height / 2 // the y of the joint the next segment hangs from
      let parent = 'torso'
      pair.segs.forEach((seg, k) => {
        const name = `S${i}${sideName[side]}${k}`
        parts.push({ name, shape: 'capsule', size: [seg.len, seg.rad], mass: Math.max(0.05, 80 * Math.PI * seg.rad * seg.rad * (seg.len + 1.33 * seg.rad)), position: [pair.at * length, hang - seg.len / 2, z], color: ['#6fa8dc', '#93c47d', '#e06666'][i] })
        joints.push({ name: `J${i}${sideName[side]}${k}`, parent, child: name, anchor: [pair.at * length, hang, z], axis: seg.axis ? [1, 0, 0] : [0, 0, 1], limits: [-SWING, SWING], motor: { stiffness: 60, damping: 6 } })
        parent = name
        hang -= seg.len
      })
    }
  })
  return { parts, joints, sensors: [{ type: 'pose' }, { type: 'joints' }, { type: 'touch' }] }
}

// ---------------------------------------------------------------------------------------------------------
// The parent: a population of sub-simulations

const runs = new WeakMap() // what each running parent knows (a parent is data in a host, never module state)

async function launch(host, run) {
  for (const name of [...host.group.sims.keys()]) host.remove(name)
  run.start = []
  run.upright = run.genomes.map(() => ({ sum: 0, n: 0 }))
  run.tickInGen = 0
  for (let i = 0; i < run.genomes.length; i++) {
    const scene = structuredClone(host.scene)
    scene.entities[0].body = bodyOf(run.genomes[i])
    scene.data = { genome: run.genomes[i] }
    await host.add(`c${String(i + 1).padStart(2, '0')}`, scene)
  }
}

/**
 * How well each creature did: the straight-line distance it covered between landing and the end of the generation (any direction),
 * scaled by how upright it stayed when the "reward staying upright" slider is above 0. At 0, tumbling and rolling count as much as walking.
 */
function scoresOf(host, run) {
  const w = host.params.upright
  return [...host.group.sims.values()].map((sim, i) => {
    const m = sim.metrics()
    const distance = Math.hypot(m.x - run.start[i].x, m.z - run.start[i].z)
    const stood = run.upright[i].n ? Math.max(0, run.upright[i].sum / run.upright[i].n) : 0
    return distance * (1 - w + w * stood)
  })
}

export const parent = {
  async init(host) {
    const n = host.params.population
    runs.set(host, { gen: 1, genomes: Array.from({ length: n }, () => randomGenome(() => host.random(), () => host.normal())), tickInGen: 0, start: [], upright: [], scores: [], best: 0, lastBest: 0, mean: 0 })
    await launch(host, runs.get(host))
  },

  async step(host) {
    const run = runs.get(host)
    run.tickInGen++
    if (run.tickInGen > SETTLE && run.tickInGen % 10 === 0) [...host.group.sims.values()].forEach((s, i) => { run.upright[i].sum += s.metrics().upright; run.upright[i].n++ })
    if (run.tickInGen === SETTLE) run.start = [...host.group.sims.values()].map((s) => ({ x: s.metrics().x, z: s.metrics().z }))
    if (run.tickInGen < host.params.ticks) return

    // the generation is over: rank, keep the best, breed the rest
    const r = () => host.random(), normal = () => host.normal()
    const scores = scoresOf(host, run)
    const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a])
    const keep = Math.min(host.params.keep, order.length)
    run.lastBest = scores[order[0]]
    run.best = Math.max(run.best, run.lastBest)
    run.mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const tournament = () => {
      let win = order[Math.floor(r() * order.length)]
      for (let k = 0; k < 2; k++) { const c = order[Math.floor(r() * order.length)]; if (scores[c] > scores[win]) win = c }
      return run.genomes[win]
    }
    const next = order.slice(0, keep).map((i) => run.genomes[i])
    while (next.length < host.params.population) {
      const a = tournament()
      const child = r() < 0.4 ? crossover(a, tournament(), r) : a
      next.push(mutate(child, host.params.mutation, r, normal))
    }
    run.genomes = next
    run.gen++
    await launch(host, run)
  },

  status(host) {
    const run = runs.get(host)
    if (!run) return ''
    const last = run.gen > 1 ? ` · last best ${run.lastBest.toFixed(1)}, average ${run.mean.toFixed(1)} · best ever ${run.best.toFixed(1)}` : ''
    return `generation ${run.gen} (${run.tickInGen}/${host.params.ticks})${last}`
  },
}
