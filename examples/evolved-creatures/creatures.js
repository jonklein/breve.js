// Evolved creatures, after Karl Sims (1994): bodies and brains that evolve together.
//
// Three things live in this file:
//
//   the creature   a controller. Its body and brain come from the scene's `data.genome`, so the same
//                  script drives any creature a genome describes.
//   the genome     plain data, in two parts. The BODY is a short list of blocks. The first is the trunk;
//                  every other block says which earlier block it hangs from, on which face, where on
//                  that face, how big it is, which way its hinge turns, whether to repeat it as a mirror
//                  image across the body, and whether to continue it as a second segment. That is a small
//                  version of Sims' recursive graph, and it can still make legs, arms, tails, fins,
//                  spines and stacks of blocks nobody planned. The BRAIN is the weights of a small
//                  neural network with one slot for every joint a body could have.
//   the parent     a program that runs a whole population as sub-simulations, one creature each, side by
//                  side. At the end of a generation it ranks them by how far they walked, keeps the best,
//                  and breeds the rest. Evolution is written here, not in the engine.
//
// Try: raise "mutation strength" for wilder offspring, lower "survivors kept" for stronger selection, and
// click a tile to watch one creature on its own.

const BLOCKS = 7 // blocks after the trunk
const SIDES = 2 // an instance of a block is on the genome's side (0) or its mirror image (1)
const CHAIN = 2 // a block can continue as a second segment
const SLOTS = BLOCKS * SIDES * CHAIN // every joint a body could have
const SIZES = [SLOTS + 5, 12, SLOTS] // brain: joint angles, which way is up, a clock -> joint targets
const WEIGHTS = SIZES.slice(1).reduce((n, out, i) => n + (SIZES[i] + 1) * out, 0)
const SWING = 1.2 // radians a joint can turn either way
const DENSITY = 50 // kg per cubic metre of block
const MIN_MASS = 0.25 // no block is lighter than this, so no tiny limb is pushed around by a heavy trunk
const STRENGTH = 2500 // newton-metres of motor torque per square metre of a block's cross-section
const LIFT = 3 // times the torque it takes to hold its load out sideways
const MAX_JOINT_SPEED = 5 // radians per second a joint's target can move
const SETTLE = 90 // ticks a creature gets to land before its walk is measured
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const FACES = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]] // [axis, direction]: which side of the parent block
const COLORS = ['#d9a441', '#6fa8dc', '#93c47d', '#e06666', '#b48ad9', '#76d7c4']

const slotOf = (i, side, seg) => ((i - 1) * SIDES + side) * CHAIN + seg
const nameOf = (i, side, seg) => `${i}_${side}_${seg}`

// ---------------------------------------------------------------------------------------------------------
// The body: a genome becomes a tree of blocks

/**
 * Lay a genome out as blocks standing on the ground: every block with its size, where its middle is, where its joint is, and
 * which block it hangs from. A block that hangs from something that is switched off is dropped, and mirrored blocks are placed
 * on the other side of the trunk.
 */
export function layout(g) {
  const items = [{ i: 0, side: 0, seg: 0, size: g.root.slice(), center: [0, 0, 0], depth: 0, parent: null }]
  const byKey = new Map([[nameOf(0, 0, 0), items[0]]])
  const sides = [[0]] // which sides each block exists on; the trunk only on side 0
  g.blocks.forEach((b, k) => {
    const i = k + 1
    if (!b.on || !sides[b.parent]) return
    sides[i] = b.mirror ? [0, 1] : sides[b.parent]
    for (const side of sides[i]) {
      const parent = byKey.get(nameOf(b.parent, sides[b.parent].includes(side) ? side : sides[b.parent][0], 0))
      let [axis, dir] = FACES[b.face]
      if (side && axis === 2) dir = -dir // the mirror image sits on the other side
      const over = [0, 1, 2].filter((a) => a !== axis) // the two directions along the parent's face
      const offset = [0, 0, 0]
      offset[over[0]] = b.u * parent.size[over[0]] / 2
      offset[over[1]] = b.v * parent.size[over[1]] / 2
      if (side) offset[2] = -offset[2]
      let from = parent, size = b.size.slice()
      for (let seg = 0; seg < b.chain; seg++) {
        const center = from.center.map((c, a) => c + offset[a])
        center[axis] += dir * (from.size[axis] / 2 + size[axis] / 2)
        const anchor = from.center.map((c, a) => c + offset[a])
        anchor[axis] += dir * from.size[axis] / 2
        const item = { i, side, seg, size, center, anchor, depth: from.depth + 1, parent: from, hinge: seg ? b.axis2 : b.axis }
        items.push(item)
        byKey.set(nameOf(i, side, seg), item)
        from = item
        size = size.map((s) => Math.max(0.05, s * 0.8))
        offset.fill(0) // a second segment continues straight on
      }
    }
  })
  const floor = Math.min(...items.map((t) => t.center[1] - t.size[1] / 2))
  for (const t of items) {
    t.center[1] += 0.03 - floor
    if (t.anchor) t.anchor[1] += 0.03 - floor
  }
  return items
}

/** The scene's body for a genome: a box for every block and a hinge motor between each block and the one it hangs from. */
export function bodyOf(g) {
  const parts = [], joints = []
  const items = layout(g)
  const massOf = (t) => Math.max(MIN_MASS, DENSITY * t.size[0] * t.size[1] * t.size[2])
  // what each joint has to carry: the blocks beyond it (their mass, and how far out the farthest of them reaches)
  const load = new Map(items.map((t) => [t, { mass: massOf(t), reach: 0 }]))
  for (let k = items.length - 1; k > 0; k--) {
    const t = items[k]
    const own = load.get(t), up = load.get(t.parent)
    up.mass += own.mass
    up.reach = Math.max(up.reach, Math.hypot(...t.center.map((c, a) => c - t.parent.center[a])) + own.reach)
  }
  for (const t of items) {
    const name = `B${nameOf(t.i, t.side, t.seg)}`
    const mass = massOf(t)
    parts.push({ name, shape: 'box', size: t.size, mass, position: t.center, color: COLORS[t.depth % COLORS.length] })
    if (!t.parent) continue
    // A muscle's strength grows with its cross-section (an area), a block's weight with its volume: big creatures are relatively weaker,
    // as in nature. The motor cannot push harder than that, and its target moves no faster than a real limb could, so a brain cannot
    // buy impossible forces by jumping its targets around.
    // It also cannot be stronger than a few times what it takes to hold up everything beyond it, so a thick block is not a catapult.
    const [small, mid] = [...t.size].sort((a, b) => a - b)
    const carried = load.get(t)
    const maxTorque = Math.max(0.3, Math.min(STRENGTH * small * mid, LIFT * 9.81 * carried.mass * (Math.hypot(...t.center.map((c, a) => c - t.anchor[a])) + carried.reach)))
    joints.push({ name: `J${nameOf(t.i, t.side, t.seg)}`, parent: `B${nameOf(t.parent.i, t.parent.side, t.parent.seg)}`, child: name, anchor: t.anchor, axis: AXES[t.hinge], limits: [-SWING, SWING], motor: { stiffness: maxTorque * 2, damping: maxTorque * 0.3, maxTorque, maxSpeed: MAX_JOINT_SPEED } })
  }
  return { parts, joints, sensors: [{ type: 'pose' }, { type: 'joints' }] }
}

// ---------------------------------------------------------------------------------------------------------
// The creature

export default {
  act({ self }, p, ctx) {
    const g = ctx.data.genome
    if (!g) return
    const x = new Float64Array(SIZES[0])
    const joints = self.joints
    const live = [] // [joint name, slot] for each joint this body has
    for (const t of layout(g)) {
      if (!t.parent) continue
      const name = `J${nameOf(t.i, t.side, t.seg)}`
      x[slotOf(t.i, t.side, t.seg)] = (joints[name] ?? 0) / SWING
      live.push([name, slotOf(t.i, t.side, t.seg)])
    }
    const up = self.up
    x[SLOTS] = up.x
    x[SLOTS + 1] = up.y
    x[SLOTS + 2] = up.z
    const phase = 2 * Math.PI * g.rhythm * ctx.tick * ctx.dt
    x[SLOTS + 3] = Math.sin(phase)
    x[SLOTS + 4] = Math.cos(phase)

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
  // how high and how fast: a parent uses these to spot a creature the physics has thrown across the world
  y: ({ creatures }) => mean(creatures.map((c) => c.y)),
  speed: ({ creatures }) => mean(creatures.map((c) => c.speed)),
}

// ---------------------------------------------------------------------------------------------------------
// The genome

const ROOT = [0.3, 1.2], DIM = [0.08, 0.8], RHYTHM = [0.4, 3]
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))
const between = (r, [lo, hi]) => lo + r() * (hi - lo)
const pickInt = (r, n) => Math.floor(r() * n)

/** A new block: often a long thin one (a limb, a tail), sometimes a lump, hanging from any earlier block. */
function randomBlock(r, k, on) {
  const size = [0, 0, 0].map(() => between(r, [0.08, 0.2]))
  if (r() < 0.7) size[pickInt(r, 3)] = between(r, [0.25, 0.7])
  else for (let a = 0; a < 3; a++) size[a] = between(r, [0.1, 0.5])
  return { on, parent: pickInt(r, k + 1), face: pickInt(r, 6), u: between(r, [-0.7, 0.7]), v: between(r, [-0.7, 0.7]), size, axis: pickInt(r, 3), axis2: pickInt(r, 3), mirror: r() < 0.6, chain: 1 + pickInt(r, CHAIN) }
}

export function randomGenome(r, normal) {
  return {
    root: [between(r, [0.4, 1.1]), between(r, [0.2, 0.5]), between(r, [0.3, 0.8])],
    blocks: Array.from({ length: BLOCKS }, (_, k) => randomBlock(r, k + 1 - 1, k < 2 || r() < 0.4)),
    rhythm: between(r, RHYTHM),
    weights: Array.from({ length: WEIGHTS }, () => 0.6 * normal()),
  }
}

/** A child: the trunk and each block from either parent, each weight from either parent. */
export function crossover(a, b, r) {
  const pick = (x, y) => (r() < 0.5 ? x : y)
  return structuredClone({
    root: pick(a.root, b.root),
    blocks: a.blocks.map((blk, k) => pick(blk, b.blocks[k])),
    rhythm: pick(a.rhythm, b.rhythm),
    weights: a.weights.map((w, i) => pick(w, b.weights[i])),
  })
}

/** A copy with some genes nudged, blocks added, dropped or moved. `strength` 0..1 scales how many change and by how much. */
export function mutate(g, strength, r, normal) {
  const c = structuredClone(g)
  const chance = (p) => r() < p * strength
  const grow = (v, range) => clamp(v * Math.exp(normal() * 0.25 * strength), range) // sizes change by a factor
  for (let a = 0; a < 3; a++) if (chance(0.4)) c.root[a] = grow(c.root[a], ROOT)
  if (chance(0.4)) c.rhythm = clamp(c.rhythm + normal() * 0.3 * strength, RHYTHM)
  c.blocks.forEach((b, k) => {
    const i = k + 1
    if (!b.on) {
      if (chance(0.12)) c.blocks[k] = randomBlock(r, i - 1, true) // a new block appears
      return
    }
    for (let a = 0; a < 3; a++) if (chance(0.35)) b.size[a] = grow(b.size[a], DIM)
    if (chance(0.3)) b.u = clamp(b.u + normal() * 0.3 * strength, [-0.9, 0.9])
    if (chance(0.3)) b.v = clamp(b.v + normal() * 0.3 * strength, [-0.9, 0.9])
    if (chance(0.1)) b.face = pickInt(r, 6)
    if (chance(0.1)) b.axis = pickInt(r, 3)
    if (chance(0.1)) b.axis2 = pickInt(r, 3)
    if (chance(0.1)) b.mirror = !b.mirror
    if (chance(0.1)) b.chain = 1 + pickInt(r, CHAIN)
    if (chance(0.1)) b.parent = pickInt(r, i) // hang from a different earlier block
    if (k > 0 && chance(0.06)) b.on = false // and a block can disappear, with whatever hung from it
  })
  for (let i = 0; i < c.weights.length; i++) if (r() < 0.12 * Math.max(strength, 0.05)) c.weights[i] += normal() * 0.5 * strength
  return c
}

// ---------------------------------------------------------------------------------------------------------
// The parent: a population of sub-simulations

const runs = new WeakMap() // what each running parent knows (a parent is data in a host, never module state)

async function launch(host, run) {
  for (const name of [...host.group.sims.keys()]) host.remove(name)
  run.start = []
  run.upright = run.genomes.map(() => ({ sum: 0, n: 0 }))
  run.thrown = run.genomes.map(() => false)
  run.stand = run.genomes.map((g) => layout(g)[0].center[1]) // how high the trunk's middle is when standing
  run.tickInGen = 0
  for (let i = 0; i < run.genomes.length; i++) {
    const scene = structuredClone(host.scene)
    scene.entities[0].body = bodyOf(run.genomes[i])
    scene.data = { genome: run.genomes[i] }
    await host.add(`c${String(i + 1).padStart(2, '0')}`, scene)
  }
}

// A body that overlaps itself can make the physics engine throw it across the world; that is not walking. A creature that is
// ever faster than this, rises far above where it stands, or leaves the ground, scores nothing.
const MAX_RISE = 1 // metres the trunk may rise above where it stands
const MAX_SPEED = 6

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
    return run.thrown[i] ? 0 : distance * (1 - w + w * stood)
  })
}

export const parent = {
  async init(host) {
    const n = host.params.population
    runs.set(host, { gen: 1, genomes: Array.from({ length: n }, () => randomGenome(() => host.random(), () => host.normal())), tickInGen: 0, start: [], upright: [], thrown: [], stand: [], scores: [], best: 0, lastBest: 0, mean: 0 })
    await launch(host, runs.get(host))
  },

  async step(host) {
    const run = runs.get(host)
    run.tickInGen++
    if (run.tickInGen > SETTLE && run.tickInGen % 5 === 0) {
      const half = host.scene.terrain.size / 2 - 1
      ;[...host.group.sims.values()].forEach((s, i) => {
        const m = s.metrics()
        if (m.y > run.stand[i] + MAX_RISE) run.thrown[i] = true
        run.upright[i].sum += m.upright
        run.upright[i].n++
        if (m.speed > MAX_SPEED || m.y < -0.5 || Math.abs(m.x) > half || Math.abs(m.z) > half) run.thrown[i] = true
      })
    }
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
