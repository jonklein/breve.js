// Conway's Game of Life on a flat grid, written for big grids.
//
// Instead of deciding one cell at a time, `actAll` gets each field as a whole:
// `alive.neighborSum()` is the number of live neighbors of every cell at once, and `eq`, `and`, `or`
// and `where` work on whole fields too, with no function call per cell. That makes it fast enough for
// a million cells (try the headless benchmark).
//
//   A dead cell with exactly 3 living neighbors comes alive.
//   A living cell with 2 or 3 living neighbors stays alive.
export default {
  // every cell at once: a share of them (the `density` slider) alive
  initAll({ count }, p, ctx) {
    return { alive: Float32Array.from({ length: count }, () => (ctx.random() < p.density ? 1 : 0)), age: new Float32Array(count) }
  },

  // the same look as the 3D version, for every cell at once
  displayAll({ alive, age }, p, ctx) {
    return { visible: alive, color: ctx.colors.rampField(['#ff0d0d', '#0dff0d'], age.div(30)) }
  },

  actAll({ alive, age }) {
    const crowd = alive.neighborSum()
    // born with exactly 3 neighbors, or alive with exactly 2 (comparisons give 1 or 0, so they combine like switches)
    const next = crowd.eq(3).or(alive.and(crowd.eq(2)))
    return { alive: next, age: next.where(age.add(1), 0) }
  },
}

export const metrics = {
  population: ({ cells }) => cells.alive.sum(),
}
