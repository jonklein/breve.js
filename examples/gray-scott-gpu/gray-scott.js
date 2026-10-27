// Reaction-diffusion, the Gray-Scott model, on a million cells, written as formulas so the graphics card can run it.
//
// The same chemistry as the processor version (*Reaction-diffusion*): u is supplied everywhere, v eats u and grows where it has a foothold,
// both spread out, and v breaks down. What is different is how it is written. `actFormula` is called ONCE; its `u` and `v` are placeholders,
// and what it returns describes one small step for every cell. The scene asks for `substeps: "$speed"`, so the engine runs that step
// several times per tick, all on the card. (A loop over `p.speed` in here would not work: the rule runs once, before any number is known.)
//
// Click and drag in the picture to move around, scroll to zoom in on the patterns.
const BLOBS = 120 // how many places v starts from

export default {
  // u everywhere, and square blobs of v at random places (`k.random('name')` is one random number for the whole grid, so each blob gets its own place)
  initFormula: (fields, p, k) => {
    const [nx, ny] = k.size
    let inBlob = null
    for (let b = 0; b < BLOBS; b++) {
      const cx = k.random(`blob-x-${b}`).mul(nx).floor()
      const cy = k.random(`blob-y-${b}`).mul(ny).floor()
      const here = k.x.sub(cx).abs().le(4).and(k.y.sub(cy).abs().le(4))
      inBlob = inBlob ? inBlob.or(here) : here
    }
    return { u: inBlob.where(0.5, 1), v: inBlob.where(0.25, 0) }
  },

  actFormula: ({ u, v }, p) => {
    // how much each cell differs from the average of its neighbors is all that diffusion needs
    const diffusionU = u.neighborAverage().sub(u)
    const diffusionV = v.neighborAverage().sub(v)
    const reaction = u.mul(v).mul(v) // u + 2v -> 3v: some u is used up and becomes v
    const nextU = u.add(diffusionU.mul(p.diffusionU)).sub(reaction).sub(p.supply.mul(u.sub(1))) // supply tops u back up toward 1
    const nextV = v.add(diffusionV.mul(p.diffusionV)).add(reaction).sub(v.mul(p.supply.add(p.decay))) // v decays (and is washed out as u is supplied)
    return { u: nextU.clamp(0, 1), v: nextV.clamp(0, 1) }
  },

  // colored along the chosen palette by how much v there is (the palette is in the scene's data, so a control can change it)
  displayFormula: ({ v }, p, k) => k.gradient(PALETTES[k.data?.palette] ?? PALETTES.ocean, v.mul(p.brightness)),
}

const PALETTES = {
  ocean: ['#0b1230', '#17509c', '#2fb8bd', '#f6efc4'],
  fire: ['#10040a', '#7a1250', '#e8452e', '#ffd25a', '#fff6d8'],
  aurora: ['#07102b', '#2a2f8f', '#16b6a0', '#9be564', '#f4f06a'],
  rainbow: ['#1b0b3a', '#3a3cc8', '#18c4c4', '#7be45a', '#ffd23f', '#ff5a5f'],
  candy: ['#2b1055', '#c13fa8', '#ff7ab6', '#ffd1a8', '#fffbe8'],
  mono: ['#0a0a0c', '#4a4f5c', '#aab0bd', '#ffffff'],
}

export const metrics = {
  // how much v there is: pattern growth shows up as this rising, then levelling off
  chemicalV: ({ cells }) => cells.v.average(),
}
