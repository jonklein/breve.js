// Neural agents that evolve. Each walker has its own little brain, a neural network with 11 inputs, 5 hidden
// cells and 8 outputs. The brain sees where the glowing goal is, where its nearest neighbor is, and its own
// `memory` (5 numbers it wrote on the previous tick). It answers with a push (3 numbers) and a new memory (5 numbers).
//
// Three things live in this file:
//
//   the walker   a controller. Its weights come from the scene's `data.weights`, so the same script runs any brain.
//   the goal     a glowing ball that jumps to a new place every `hop` ticks. Nobody tells a brain what it is for.
//   the parent   a program that runs a whole population as sub-simulations, one brain each (every walker in a
//                tile shares that brain). At the end of a generation it scores each tile by how close its walkers
//                stayed to the goal, keeps the best brains, and breeds the rest. Evolution is written here, not
//                in the engine, exactly as in the Evolved creatures example.
//
// The first generation is random wanderers. Watch the status line: the average score climbs as brains that
// happen to head for the goal are copied and mutated, until the crowds home in on it each time it jumps.
const WEIGHTS = 108 // ctx.mlp([11, 5, 8]) needs 11*5+5 + 5*8+8 numbers
const SETTLE = 30 // ticks a generation gets before scoring starts

// where the goal is at a tick: a point on a ring around the middle, the same in every tile and every run
function hash(n, salt) {
  let h = Math.imul(n + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}
function goalAt(tick, hop, size) {
  const k = Math.floor(tick / hop)
  const angle = hash(k, 1) * Math.PI * 2
  const reach = size * (0.35 + 0.4 * hash(k, 2))
  return [Math.cos(angle) * reach, 0, Math.sin(angle) * reach]
}

// ---------------------------------------------------------------------------------------------------------
// The walker

export default {
  // the brain is the scene's `data.weights` (random weights, spread 0.7 around zero, if there are none) and an empty memory
  init(self, p, ctx) {
    const weights = ctx.data.weights ? Float32Array.from(ctx.data.weights) : Float32Array.from({ length: WEIGHTS }, () => 0.7 * ctx.normal())
    return { weights, memory: [0, 0, 0, 0, 0] }
  },

  act({ self, neighbors }, p, ctx) {
    const brain = ctx.mlp([11, 5, 8])
    const size = ctx.world.size

    const toGoal = ctx.vec(...goalAt(ctx.tick, p.hop, size)).minus(self.position).dividedBy(size)
    const near = neighbors.nearest()
    const toNear = near ? near.position.minus(self.position).dividedBy(p.radius) : ctx.vec(0, 0, 0)

    const seen = [...toGoal.toArray(), ...toNear.toArray(), ...self.memory]
    const [x, y, z, ...memory] = brain.run(self.weights, seen)

    return {
      steer: ctx.vec(x, y, z).times(p.push).plus(ctx.bounds.soft(self.position, size)), // soft walls from the stdlib
      state: { memory },
    }
  },
}

// the goal: starts at its first place and jumps whenever `hop` ticks have passed
export const Goal = {
  init(self, p, ctx) {
    return { position: goalAt(0, p.hop, ctx.world.size) }
  },
  act({ self }, p, ctx) {
    if (ctx.tick > 0 && ctx.tick % p.hop === 0) self.place({ position: goalAt(ctx.tick, p.hop, ctx.world.size) })
  },
}

export const metrics = {
  // how close the walkers are to the goal right now: 1 on top of it, 0 when 12 or more away
  near: ({ sets }) => Math.max(0, 1 - sets.walker.position.minus(sets.goal.position.average()).lengths().average() / 12),
}

// ---------------------------------------------------------------------------------------------------------
// The parent: a population of sub-simulations

const runs = new WeakMap() // what each running parent knows (a parent is data in a host, never module state)

async function launch(host, run) {
  for (const name of [...host.group.sims.keys()]) host.remove(name)
  run.tickInGen = 0
  run.sum = run.brains.map(() => 0)
  run.samples = 0
  for (let i = 0; i < run.brains.length; i++) {
    const scene = structuredClone(host.scene)
    scene.data = { weights: run.brains[i] }
    await host.add(`b${String(i + 1).padStart(2, '0')}`, scene)
  }
}

export const parent = {
  async init(host) {
    const n = host.params.population
    const brains = Array.from({ length: n }, () => Array.from({ length: WEIGHTS }, () => 0.7 * host.normal()))
    runs.set(host, { gen: 1, brains, tickInGen: 0, sum: [], samples: 0, best: 0, lastBest: 0, mean: 0 })
    await launch(host, runs.get(host))
  },

  async step(host) {
    const run = runs.get(host)
    run.tickInGen++
    if (run.tickInGen > SETTLE && run.tickInGen % 5 === 0) {
      ;[...host.group.sims.values()].forEach((s, i) => { run.sum[i] += s.metrics().near })
      run.samples++
    }
    if (run.tickInGen < host.params.ticks) return

    // the generation is over: rank, keep the best, breed the rest
    const r = () => host.random()
    const scores = run.sum.map((s) => (run.samples ? s / run.samples : 0))
    const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a])
    const keep = Math.min(host.params.keep, order.length)
    run.lastBest = scores[order[0]]
    run.best = Math.max(run.best, run.lastBest)
    run.mean = scores.reduce((a, b) => a + b, 0) / scores.length
    // a parent is the best of three random picks, so good brains are copied more but not only the very best
    const tournament = () => {
      let win = order[Math.floor(r() * order.length)]
      for (let k = 0; k < 2; k++) { const c = order[Math.floor(r() * order.length)]; if (scores[c] > scores[win]) win = c }
      return run.brains[win]
    }
    const next = order.slice(0, keep).map((i) => run.brains[i])
    while (next.length < host.params.population) {
      const a = tournament()
      const b = r() < 0.4 ? tournament() : a // sometimes mix two parents, weight by weight
      next.push(a.map((w, k) => (r() < 0.5 ? w : b[k]) + (r() < 0.3 ? host.params.mutation * host.normal() : 0)))
    }
    run.brains = next
    run.gen++
    await launch(host, run)
  },

  status(host) {
    const run = runs.get(host)
    if (!run) return ''
    const last = run.gen > 1 ? ` · last best ${run.lastBest.toFixed(2)}, average ${run.mean.toFixed(2)} · best ever ${run.best.toFixed(2)}` : ''
    return `generation ${run.gen} (${run.tickInGen}/${host.params.ticks})${last}`
  },
}
