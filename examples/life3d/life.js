// 3D Game of Life, using the common B5/S45 rule.
//
// Every cell has 26 neighbors (and the grid wraps around at the edges).
//   A dead cell comes alive when exactly 5 of its neighbors are alive.
//   A living cell stays alive when 4 or 5 of its neighbors are alive.
// Cells that keep surviving get older, and older cells are drawn greener.
//
// Change these two lists to try other rules. (The original breve demo used
// BORN = [4] and SURVIVES = [4, 6], which stays busy instead of dying out.)
const BORN = [5]
const SURVIVES = [4, 5]

export default {
  // how each cell starts: a share of them (the `density` slider) alive
  init(self, p, ctx) {
    return { alive: ctx.random() < p.density ? 1 : 0, age: 0 }
  },

  act({ self, neighbors }) {
    const crowd = neighbors.alive.sum() // how many neighbors are alive

    const survives = self.alive && SURVIVES.includes(crowd)
    const born = !self.alive && BORN.includes(crowd)

    return { alive: survives || born ? 1 : 0, age: survives ? self.age + 1 : 0 }
  },
}

export const metrics = {
  population: ({ cells }) => cells.alive.sum(),
}
