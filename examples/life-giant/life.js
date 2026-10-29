// Life on a grid of 16 million cells, run entirely on the graphics card.
//
// The same rule as the small formula version, written as three expressions the engine reads once. The card keeps every cell in its own
// memory and works out the next generation for all of them at the same time; the picture is made there too, of just the part of the grid
// you are looking at. Scroll to zoom in, drag to move around. (Without WebGPU this grid is too big to run, and the scene says so.)
export default {
  // only the middle quarter of the grid (a square half as wide and half as tall) starts populated; life spreads out from there
  initFormula: (fields, p, k) => {
    const [nx, ny] = k.size
    const middle = k.x.sub(nx / 2).abs().lt(nx / 4).and(k.y.sub(ny / 2).abs().lt(ny / 4))
    return { alive: middle.and(k.hash('start').lt(p.density)) }
  },

  actFormula: ({ alive }) => {
    const crowd = alive.neighborSum()
    return { alive: crowd.eq(3).or(alive.and(crowd.eq(2))) }
  },

  // living cells are colored by where they are: `k.x` and `k.y` are each cell's column and row
  displayFormula: ({ alive }, p, k) => ({ visible: alive, r: k.x.div(4096).mul(0.8).add(0.2), g: k.y.div(4096).mul(0.8).add(0.2), b: 1 }),
}

export const metrics = {
  population: ({ cells }) => cells.alive.sum(),
}
