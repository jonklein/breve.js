// A hypercycle: molecules that each help the next one copy itself, in a ring (1 helps 2, 2 helps 3, ... 5 helps 1).
//
// On their own, rivals crowd each other out. In a ring, every member needs the one before it, so none can win
// without the rest: they all survive, and on a surface they chase each other around in spiral waves.
// This is Eigen and Schuster's idea of how life's first molecules could have cooperated.
//
// Each cell is empty (0), one of the five members (1 to 5), or a parasite (6).
//   - A member dies now and then.
//   - An empty cell can be filled by a copy of a neighbor. A member copies faster when a neighbor of
//     the species before it in the ring is nearby to help.
//   - A parasite gets help from member 1 but helps nobody back. It breaks the ring... or does it?
//     Raise the `parasites` slider and see whether the spirals hold up.
const MEMBERS = 5
const PARASITE = MEMBERS + 1
const COLORS = ['#10151f', '#ff5a5f', '#ffb347', '#f4e25a', '#4fd1a5', '#5aa9ff', '#f2f2f2']

export default {
  // random species in a share of the cells (`fill`), and a few parasites
  initAll({ count }, p, ctx) {
    const species = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      if (ctx.random() < p.fill) species[i] = 1 + Math.floor(ctx.random() * MEMBERS)
      if (p.parasites > 0 && ctx.random() < 0.004 * p.parasites) species[i] = PARASITE
    }
    return { species }
  },

  // empty cells are not drawn; the rest take their species' color
  display({ self }, p, ctx) {
    return { visible: self.species > 0, color: COLORS[self.species] }
  },

  act({ self, neighbors }, p, ctx) {
    if (self.species !== 0) {
      return ctx.random() < p.death ? { species: 0 } : {} // alive cells just die at random
    }

    // an empty cell: count the species around it
    const around = new Array(PARASITE + 1).fill(0)
    for (const s of neighbors.species) around[s]++

    // how strongly each species wants to fill this cell: more neighbors of it, and more help from the one before it
    const want = new Array(PARASITE + 1).fill(0)
    let total = 0
    for (let s = 1; s <= MEMBERS; s++) {
      const before = s === 1 ? MEMBERS : s - 1
      want[s] = around[s] * (p.base + p.help * around[before])
      total += want[s]
    }
    want[PARASITE] = p.parasites * around[PARASITE] * (p.base + p.help * around[1]) // helped by member 1, helps nobody
    total += want[PARASITE]

    if (total === 0 || ctx.random() > total / (1 + total)) return {}
    // choose who fills it, in proportion to how much each wanted to
    let pick = ctx.random() * total
    for (let s = 1; s <= PARASITE; s++) {
      pick -= want[s]
      if (pick <= 0) return { species: s }
    }
    return {}
  },
}

const count = (cells, s) => cells.species.filter((x) => x === s).length

export const metrics = {
  // how many cells each member holds: in a healthy hypercycle all five stay alive
  member1: ({ cells }) => count(cells, 1),
  member2: ({ cells }) => count(cells, 2),
  member3: ({ cells }) => count(cells, 3),
  member4: ({ cells }) => count(cells, 4),
  member5: ({ cells }) => count(cells, 5),
  parasites: ({ cells }) => count(cells, PARASITE),
}
