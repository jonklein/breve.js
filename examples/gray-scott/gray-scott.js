// Reaction-diffusion: the Gray-Scott model, the pattern-maker behind spots, stripes, mazes and coral.
//
// Two chemicals share a sheet, and three things happen to them:
//
//   reaction   u + 2v -> 3v: where v is present, it turns u into more v
//   diffusion  both chemicals spread out into neighboring cells, u faster than v
//   decay      v breaks down; u is supplied everywhere to replace what the reaction uses up
//
// Where v gets a foothold it grows into spots that split, stripes that wander, or labyrinths,
// depending mostly on two numbers:
//
//   supply  how fast u is topped up          decay  how fast v breaks down
//
// The preset buttons set (supply, decay) for the classic patterns. Then try the sliders: the diffusion
// rates change how fine the pattern is. The picture is two chemicals added together: red is v, blue is u.
//
// The whole sheet is updated at once with field arithmetic: `u.neighborAverage().sub(u)` is how much
// each cell differs from its neighbors, which is all that diffusion needs.
const BLOBS = 8 // how many places v starts from, all inside the middle quarter

export default {
  // u everywhere, with a few blobs of v at random places inside the middle quarter of the sheet; the pattern grows outward from there
  initAll({ count }, p, ctx) {
    const size = Math.round(Math.sqrt(count))
    const u = new Float32Array(count).fill(1)
    const v = new Float32Array(count)
    for (let b = 0; b < BLOBS; b++) {
      const cx = Math.floor(size / 4 + ctx.random() * (size / 2))
      const cy = Math.floor(size / 4 + ctx.random() * (size / 2))
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

  // every cell is drawn: red is v, blue is u (dim, so the ground is dark), and where both are present they add
  displayAll({ u, v }) {
    return { visible: v.ge(-1), color: { r: v.mul(2.4).clamp(0, 1), g: v.mul(0.1).clamp(0, 1), b: u.mul(0.55) } }
  },

  actAll({ u, v }, p) {
    // each tick runs several small steps, so the pattern grows at a watchable speed
    for (let step = 0; step < p.speed; step++) {
      const diffusionU = u.neighborAverage().sub(u)
      const diffusionV = v.neighborAverage().sub(v)
      const reaction = u.mul(v).mul(v) // u + 2v -> 3v: some u is used up and becomes v
      const nextU = u.add(diffusionU.mul(p.diffusionU)).sub(reaction).add(u.mul(-p.supply).add(p.supply)) // supply tops u back up toward 1
      const nextV = v.add(diffusionV.mul(p.diffusionV)).add(reaction).sub(v.mul(p.supply + p.decay)) // v decays (and is washed out as u is supplied)
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
