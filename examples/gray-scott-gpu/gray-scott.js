// Reaction-diffusion, the Gray-Scott model, on a million cells, written as formulas so the graphics card can run it.
//
// The same chemistry as the processor version (*Reaction-diffusion*): u is supplied everywhere, v eats u and grows where it has a foothold,
// both spread out, and v breaks down. The sheet starts empty except for a few blobs of v in its middle quarter, and the pattern grows out from there. What is different is how it is written. `actFormula` is called ONCE; its `u` and `v` are placeholders,
// and what it returns describes one small step for every cell. The scene asks for `substeps: "$speed"`, so the engine runs that step
// several times per tick, all on the card. (A loop over `p.speed` in here would not work: the rule runs once, before any number is known.)
//
// The picture is two chemicals added together: red where v is, blue where u is. Click and drag to move around, scroll to zoom in on the patterns.
const BLOBS = 30 // how many places v starts from, all inside the middle quarter

export default {
  // u everywhere, with square blobs of v at random places inside the middle quarter of the sheet (a square half as wide and half as tall);
  // the pattern grows outward from there. (`k.random('name')` is one random number for the whole grid, so each blob gets its own place.)
  initFormula: (fields, p, k) => {
    const [nx, ny] = k.size
    let inBlob = null
    for (let b = 0; b < BLOBS; b++) {
      const cx = k.random(`blob-x-${b}`).mul(nx / 2).add(nx / 4).floor()
      const cy = k.random(`blob-y-${b}`).mul(ny / 2).add(ny / 4).floor()
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

  // one fixed picture: v is red, u is a dim blue, and where both are present they add (purple) on a dark ground
  displayFormula: ({ u, v }) => ({ r: v.mul(4).clamp(0, 1), g: v.mul(0.15).clamp(0, 1), b: u.mul(0.2) }),
}

export const metrics = {
  // how much v there is: pattern growth shows up as this rising, then levelling off
  chemicalV: ({ cells }) => cells.v.average(),
}
