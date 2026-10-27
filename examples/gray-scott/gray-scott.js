// Reaction-diffusion: the Gray-Scott model, the pattern-maker behind spots, stripes, mazes and coral.
//
// Two chemicals share a sheet. `u` is food that is fed in everywhere; `v` eats it, makes more of itself,
// and is slowly removed. Both spread out, `u` faster than `v`. Where `v` gets a foothold it grows into
// spots that split, stripes that wander, or labyrinths, depending on just two numbers:
//
//   feed  how fast food is added          kill  how fast v is removed
//
// Try these (feed, kill):  spots that divide 0.037, 0.065 · stripes 0.078, 0.061 · coral 0.055, 0.062
//                          waves 0.026, 0.051 · holes 0.039, 0.058 · solitons 0.030, 0.060
//
// The whole sheet is updated at once with field arithmetic: `u.neighborAverage().sub(u)` is how much
// each cell differs from its neighbors, which is all that "spreading out" needs.
const DU = 1.0
const DV = 0.5

export default {
  // food everywhere, and a few random blobs of v to start things off
  initAll({ count }, p, ctx) {
    const size = Math.round(Math.sqrt(count))
    const u = new Float32Array(count).fill(1)
    const v = new Float32Array(count)
    for (let b = 0; b < p.blobs; b++) {
      const cx = Math.floor(ctx.random() * size)
      const cy = Math.floor(ctx.random() * size)
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const i = ((cy + dy + size) % size) * size + ((cx + dx + size) % size)
          u[i] = 0.5
          v[i] = 0.25
        }
      }
    }
    return { u, v }
  },

  // every cell is drawn, colored by how much v is there: deep blue, through teal, to cream
  displayAll({ v }, p, ctx) {
    return { visible: v.ge(-1), color: ctx.colors.rampField(['#0b1230', '#17509c', '#2fb8bd', '#f6efc4'], v.mul(3)) }
  },

  actAll({ u, v }, p) {
    // each tick runs several small steps, so the pattern grows at a watchable speed
    for (let step = 0; step < p.speed; step++) {
      const spreadU = u.neighborAverage().sub(u)
      const spreadV = v.neighborAverage().sub(v)
      const react = u.mul(v).mul(v) // u is eaten by v, and turned into more v
      const nextU = u.add(spreadU.mul(DU)).sub(react).add(u.mul(-p.feed).add(p.feed))
      const nextV = v.add(spreadV.mul(DV)).add(react).sub(v.mul(p.feed + p.kill))
      u = nextU.clamp(0, 1)
      v = nextV.clamp(0, 1)
    }
    return { u, v }
  },
}

export const metrics = {
  // how much v there is: pattern growth shows up as this rising, then levelling off
  chemicalV: ({ cells }) => cells.v.average(),
}
