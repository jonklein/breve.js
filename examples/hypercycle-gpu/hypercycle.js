// A hypercycle on a million cells, written as formulas so the graphics card can run it.
//
// Five chemicals in a ring, each a catalyst for the replication of the next (1 speeds up the copying of 2, ... 5 of 1). Alone, rival
// replicators crowd each other out; in a ring none can win without the one before it, so all five persist and chase each other around in
// spiral waves (Eigen and Schuster's hypercycle). The same chemistry as the processor version (*Hypercycle*); what differs is how it is
// written. `actFormula` is called ONCE, and what it returns is one small step for every cell; the scene's `substeps: "$speed"` runs that
// step several times per tick, all on the card.
//
// The sheet starts empty except for a random mixture in its middle quarter; the reaction fills the rest as the chemicals diffuse outward.
// The picture adds up five colors by concentration (the strongest sharpened by cubing), on a dark ground.
const N = 5
const NAMES = ['a', 'b', 'c', 'd', 'e']
const HUES = ['#ff2a4a', '#ffb000', '#3dff6a', '#10c8ff', '#b24bff'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255))
const sum = (list) => list.reduce((a, b) => a.add(b))

export default {
  // a random mixture (five positive numbers that add up to 1) in the middle quarter of the sheet, nothing elsewhere
  initFormula: (fields, p, k) => {
    const [nx, ny] = k.size
    const middle = k.x.sub(nx / 2).abs().lt(nx / 4).and(k.y.sub(ny / 2).abs().lt(ny / 4))
    const raw = NAMES.map((n) => { const h = k.hash(`start-${n}`); return h.mul(h).add(0.001) })
    const total = sum(raw)
    return Object.fromEntries(NAMES.map((n, s) => [n, middle.where(raw[s].div(total), 0)]))
  },

  actFormula: (f, p) => {
    const x = NAMES.map((n) => f[n])
    const made = x.map((c, s) => c.mul(x[(s + N - 1) % N].mul(p.help).add(p.base))) // copied, catalyzed by the one before it
    const total = sum(made)
    return Object.fromEntries(NAMES.map((n, s) => {
      const c = x[s]
      const reacted = c.add(made[s].sub(c.mul(total)).mul(p.dt)) // made, and balanced against everyone so the total stays 1
      return [n, reacted.add(c.neighborAverage().sub(c).mul(p.spread)).clamp(0, 1)] // and diffusing into the neighbors
    }))
  },

  // one color per chemical, added up by how much of it is there; cubing the amounts lets the strongest one dominate, and an empty cell is dark
  displayFormula: (f) => {
    const x = NAMES.map((n) => f[n])
    const cubes = x.map((c) => c.mul(c).mul(c))
    const sharp = sum(cubes).add(1e-6)
    const light = sum(x).clamp(0, 1)
    const channel = (i) => sum(cubes.map((c, s) => c.mul(HUES[s][i]))).div(sharp).mul(light)
    return { r: channel(0), g: channel(1), b: channel(2) }
  },
}

export const metrics = Object.fromEntries(NAMES.map((n, s) => [`chemical${s + 1}`, ({ cells }) => cells[n].average()]))
