// Particle Life: a few kinds of dots, and one table that says which kinds pull toward which.
//
// Every dot feels the dots near it. Very close ones push it away (personal space, the same for everyone). Beyond that, each kind
// pulls toward or pushes from each other kind by the amount in the table: a positive entry in row A, column B means A moves toward B.
// The table is not symmetric (A can chase B while B runs from A), and that is where the life comes from: from nothing but these pulls, dots
// clump into cells, orbit each other, chase, form chains and membranes, and sometimes spin out little creatures.
//
// The table is made from `matrixSeed`, so every number on that slider is a different world. Try the sliders, then edit this file.
const attraction = (a, b, seed) => {
  // a repeatable number between -1 and 1 for this pair of kinds and this seed (no Math.random: a run must be the same every time)
  let x = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b) ^ Math.imul(seed + 1, 0xc2b2ae35)
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15
  return ((x >>> 0) / 4294967296) * 2 - 1
}

/** The whole table for these settings, as `table[a * kinds + b]`: how strongly a dot of kind `a` is pulled by one of kind `b` (the symmetry slider blends a's view of b with b's view of a). */
const tables = new Map() // a memo of a pure function of the settings, so each dot does not rebuild the table
const tableFor = (kinds, seed, symmetry) => {
  const key = `${kinds}|${seed}|${symmetry}`
  let t = tables.get(key)
  if (!t) {
    t = new Float64Array(kinds * kinds)
    for (let a = 0; a < kinds; a++) for (let b = 0; b < kinds; b++) {
      const mine = attraction(a, b, seed), theirs = attraction(b, a, seed)
      t[a * kinds + b] = mine + (theirs - mine) * 0.5 * symmetry
    }
    if (tables.size > 64) tables.clear()
    tables.set(key, t)
  }
  return t
}

export default {
  // kinds are handed out in turn
  init: ({ index }) => ({ kind: index }),

  act({ self, neighbors }, p, ctx) {
    const nKinds = p.kinds
    const table = tableFor(nKinds, p.matrixSeed, p.symmetry)
    const row = (self.kind % nKinds) * nKinds
    const offsets = neighbors.offset // from me to each neighbor
    const kinds = neighbors.kind
    let fx = 0, fz = 0
    for (let i = 0; i < offsets.length; i++) {
      const o = offsets[i]
      const d = Math.hypot(o.x, o.z)
      if (d < 1e-6 || d >= p.radius) continue
      const r = d / p.radius // 0 beside me, 1 at the edge of what I can feel
      // inside `repulsion` everyone pushes everyone away; beyond it the pull follows a tent that peaks halfway between there and the edge
      const f = r < p.repulsion ? r / p.repulsion - 1 : table[row + (kinds[i] % nKinds)] * (1 - Math.abs(2 * r - 1 - p.repulsion) / (1 - p.repulsion))
      fx += (o.x / d) * f
      fz += (o.z / d) * f
    }
    const hit = ctx.bounds.bounce(self.position, self.velocity, ctx.world.size) // walls
    const v = self.velocity
    return { steer: ctx.vec(fx * p.strength - v.x * p.friction, 0, fz * p.strength - v.z * p.friction), place: hit }
  },

  display({ self }, p, ctx) {
    return { color: ctx.colors.hsl((self.kind % p.kinds) / p.kinds, 0.85, 0.58) }
  },
}

export const metrics = {
  // how fast the dots are moving, on average: calm when everything has settled into patterns
  energy: ({ agents }) => agents.velocity.lengths().average(),
}
