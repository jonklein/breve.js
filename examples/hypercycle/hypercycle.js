// A hypercycle: chemicals that each help the next one copy itself, in a ring (1 helps 2, 2 helps 3, ... 5 helps 1).
//
// On their own, rivals crowd each other out. In a ring, every one needs the one before it, so none can win
// without the rest: they all survive, and across a surface they chase each other around in spiral waves.
// This is Eigen and Schuster's idea of how life's first molecules could have cooperated.
//
// Every cell holds a concentration of each of the five chemicals, adding up to 1. Each step:
//   - chemical i grows at a rate of  k + c * (how much of chemical i-1 is here)   [`base` and `help`]
//   - what grew is taken from everyone in proportion, so the total stays 1        [the "dilution"]
//   - every chemical spreads into its neighbors                                  [`spread`]
// The picture mixes five colors by those concentrations; `contrast` sharpens it so the waves read clearly.
const N = 5
const NAMES = ['a', 'b', 'c', 'd', 'e']
const HUES = ['#ff3b5c', '#ffb02e', '#5cf27a', '#27d6ff', '#a35cff'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255))

export default {
  // every cell starts as a random mixture
  initAll({ count }, p, ctx) {
    const x = NAMES.map(() => new Float32Array(count))
    for (let i = 0; i < count; i++) {
      let sum = 0
      for (let s = 0; s < N; s++) sum += x[s][i] = ctx.random() ** 2 + 0.001
      for (let s = 0; s < N; s++) x[s][i] /= sum
    }
    return Object.fromEntries(NAMES.map((n, s) => [n, x[s]]))
  },

  // blend the five colors by concentration, sharpened by `contrast` so the strongest one dominates
  displayAll(f, p) {
    const n = f.a.length, d = NAMES.map((k) => f[k].data)
    const out = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) }
    for (let i = 0; i < n; i++) {
      let sum = 0
      const w = d.map((c) => { const v = Math.pow(c[i], p.contrast); sum += v; return v })
      for (let s = 0; s < N; s++) {
        const k = sum > 0 ? w[s] / sum : 0
        out.r[i] += k * HUES[s][0]; out.g[i] += k * HUES[s][1]; out.b[i] += k * HUES[s][2]
      }
    }
    return { color: out }
  },

  actAll(f, p) {
    let x = NAMES.map((k) => f[k])
    for (let step = 0; step < p.speed; step++) {
      // how fast each one copies itself, helped by the one before it in the ring
      const rate = x.map((c, s) => x[(s + N - 1) % N].mul(p.help).add(p.base))
      const growth = x.map((c, s) => c.mul(rate[s]))
      const total = growth.reduce((a, g) => a.add(g))
      x = x.map((c, s) => {
        const reacted = c.add(growth[s].sub(c.mul(total)).mul(p.dt))
        return reacted.add(reacted.neighborAverage().sub(reacted).mul(p.spread)).clamp(0, 1)
      })
    }
    return Object.fromEntries(NAMES.map((n, s) => [n, x[s]]))
  },
}

// how much of the sheet each chemical holds on average: in a healthy hypercycle all five stay alive
export const metrics = Object.fromEntries(NAMES.map((n, s) => [`chemical${s + 1}`, ({ cells }) => cells[n].average()]))
