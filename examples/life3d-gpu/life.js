// 3D Life as formulas, so a big cube runs on the graphics card.
//
// The same rule as the plain 3D Life example (B5/S45 on 26 neighbors), written once as expressions instead of a function called for
// every cell. The card steps every cell of the grid at once, and `displayFormula` says which cells to draw and what color (young red,
// old green). Only the cells that are drawn cost anything on screen, so a 64 x 64 x 64 cube (262,144 cells) is comfortable.
//
//   A dead cell comes alive when exactly 5 of its 26 neighbors are alive.
//   A living cell stays alive when 4 or 5 of its neighbors are alive.
//
// Change the two numbers lists in `next` to try other rules: `crowd.eq(5)` is "born with 5", and `crowd.eq(4).or(crowd.eq(5))` is "survives with 4 or 5".
export default {
  initFormula: (fields, p, k) => ({ alive: k.hash('start').lt(p.density), age: 0 }),

  actFormula: ({ alive, age }) => {
    const crowd = alive.neighborSum()
    const born = alive.not().and(crowd.eq(5))
    const survives = alive.and(crowd.eq(4).or(crowd.eq(5)))
    const next = born.or(survives)
    return { alive: next, age: survives.where(age.add(1), 0) }
  },

  displayFormula: ({ alive, age }) => {
    const old = age.div(20).clamp(0, 1)
    return { visible: alive, r: old.mul(-0.949).add(1), g: old.mul(0.949).add(0.051), b: 0.051 }
  },
}

export const metrics = {
  population: ({ cells }) => cells.alive.sum(),
}
