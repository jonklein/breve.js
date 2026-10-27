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
// rates change how fine the pattern is, and the palette buttons change how it is colored.
//
// The whole sheet is updated at once with field arithmetic: `u.neighborAverage().sub(u)` is how much
// each cell differs from its neighbors, which is all that diffusion needs.
const PALETTES = {
  ocean: ['#0b1230', '#17509c', '#2fb8bd', '#f6efc4'],
  fire: ['#10040a', '#7a1250', '#e8452e', '#ffd25a', '#fff6d8'],
  aurora: ['#07102b', '#2a2f8f', '#16b6a0', '#9be564', '#f4f06a'],
  rainbow: ['#1b0b3a', '#3a3cc8', '#18c4c4', '#7be45a', '#ffd23f', '#ff5a5f'],
  candy: ['#2b1055', '#c13fa8', '#ff7ab6', '#ffd1a8', '#fffbe8'],
  mono: ['#0a0a0c', '#4a4f5c', '#aab0bd', '#ffffff'],
}

export default {
  // u everywhere, and a few random blobs of v to start the reaction
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

  // every cell is drawn, colored along the chosen palette by how much v is there
  displayAll({ v }, p, ctx) {
    const stops = PALETTES[ctx.data?.palette] ?? PALETTES.ocean
    return { visible: v.ge(-1), color: ctx.colors.rampField(stops, v.mul(p.brightness)) }
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
