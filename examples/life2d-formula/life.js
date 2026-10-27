// Conway's Life written as formulas: each rule is an expression, written ONCE.
//
// `actFormula` is called a single time, not every tick. Its `alive` and `age` are not numbers but places in an expression, so what
// it returns is a small program that the engine runs for every cell, every tick, on the graphics card when there is one and on the
// processor when there is not (same cells either way). That is why a formula uses methods instead of operators:
// `crowd.eq(3)` and `age.add(1)` rather than `crowd == 3` and `age + 1`, and `where` instead of `if`.
//
//   A dead cell with exactly 3 living neighbors comes alive.
//   A living cell with 2 or 3 living neighbors stays alive.
export default {
  // what the cells start as: `k.hash()` is a random number in [0, 1) that is different for every cell
  // and the same on every run, so "a share `density` of the cells alive" is one comparison
  initFormula: (fields, p, k) => ({ alive: k.hash('start').lt(p.density), age: 0 }),

  actFormula: ({ alive, age }) => {
    const crowd = alive.neighborSum()
    // born with exactly 3 neighbors, or alive with exactly 2 (comparisons give 1 or 0, so they combine like switches)
    const next = crowd.eq(3).or(alive.and(crowd.eq(2)))
    return { alive: next, age: next.where(age.add(1), 0) }
  },

  // young cells red, old cells green: a blend from one color to the other as age goes from 0 to 30
  displayFormula: ({ alive, age }) => {
    const old = age.div(30).clamp(0, 1)
    return { visible: alive, r: old.mul(-0.949).add(1), g: old.mul(0.949).add(0.051), b: 0.051 }
  },
}

export const metrics = {
  population: ({ cells }) => cells.alive.sum(),
}
