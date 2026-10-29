// A hypercycle: five chemicals in a ring, each one a catalyst for the replication of the next (1 speeds up the copying of 2, 2 of 3, ... 5 of 1).
//
// On their own, rival replicators crowd each other out. In a ring, every one needs the catalyst before it, so none can win without
// the rest: all five persist, and across a surface their concentrations chase each other around in spiral waves. This is Eigen and
// Schuster's idea of how the first self-copying molecules could have coexisted.
//
// Every cell holds a concentration of each of the five chemicals, adding up to 1. Each step, in every cell:
//   - chemical i is made at a rate of  c_i * (k + c * [chemical i-1])   [`base` is uncatalyzed copying, `help` the catalysis by the one before]
//   - what was made is balanced against everyone in proportion, so the total stays 1    [dilution]
//   - every chemical diffuses into the neighboring cells                                 [`spread`]
// The sheet starts empty except for a random mixture in its middle quarter; the reaction fills the rest as the chemicals diffuse outward.
// The picture adds up five colors by concentration (each strongest one is sharpened by cubing), on a dark ground.
const N = 5
const NAMES = ['a', 'b', 'c', 'd', 'e']
const HUES = ['#ff2a4a', '#ffb000', '#3dff6a', '#10c8ff', '#b24bff'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255))

export default {
  // a random mixture in the middle quarter of the sheet (a square half as wide and half as tall), nothing elsewhere
  initAll({ count }, p, ctx) {
    const size = Math.round(Math.sqrt(count))
    const x = NAMES.map(() => new Float32Array(count))
    for (let row = Math.floor(size / 4); row < Math.ceil((3 * size) / 4); row++) {
      for (let col = Math.floor(size / 4); col < Math.ceil((3 * size) / 4); col++) {
        const i = row * size + col
        let sum = 0
        for (let s = 0; s < N; s++) sum += x[s][i] = ctx.random() ** 2 + 0.001
        for (let s = 0; s < N; s++) x[s][i] /= sum
      }
    }
    return Object.fromEntries(NAMES.map((n, s) => [n, x[s]]))
  },

  // add up the five colors by concentration; cubing the concentrations makes the strongest one dominate, so the waves read as clean colors
  displayAll(f) {
    const n = f.a.length, d = NAMES.map((k) => f[k].data)
    const out = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) }
    for (let i = 0; i < n; i++) {
      let sum = 0, total = 0
      const w = d.map((c) => { total += c[i]; const v = c[i] ** 3; sum += v; return v })
      const light = Math.min(1, total) // an empty cell is dark
      for (let s = 0; s < N; s++) {
        const k = sum > 0 ? (w[s] / sum) * light : 0
        out.r[i] += k * HUES[s][0]; out.g[i] += k * HUES[s][1]; out.b[i] += k * HUES[s][2]
      }
    }
    return { color: out }
  },

  actAll(f, p) {
    let x = NAMES.map((k) => f[k])
    for (let step = 0; step < p.speed; step++) {
      // how fast each one is copied, catalyzed by the one before it in the ring
      const rate = x.map((c, s) => x[(s + N - 1) % N].mul(p.help).add(p.base))
      const made = x.map((c, s) => c.mul(rate[s]))
      const total = made.reduce((a, g) => a.add(g))
      x = x.map((c, s) => {
        const reacted = c.add(made[s].sub(c.mul(total)).mul(p.dt))
        return reacted.add(reacted.neighborAverage().sub(reacted).mul(p.spread)).clamp(0, 1)
      })
    }
    return Object.fromEntries(NAMES.map((n, s) => [n, x[s]]))
  },
}

// the average concentration of each chemical over the sheet: in a healthy hypercycle all five stay present
export const metrics = Object.fromEntries(NAMES.map((n, s) => [`chemical${s + 1}`, ({ cells }) => cells[n].average()]))
