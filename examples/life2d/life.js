// Conway's Game of Life on a flat grid, written for big grids.
//
// Instead of deciding one cell at a time, `update` gets each field as a whole:
// `alive.neighborSum()` is the number of live neighbors of every cell at once.
// That makes it fast enough for a million cells (try the headless benchmark).
//
//   A dead cell with exactly 3 living neighbors comes alive.
//   A living cell with 2 or 3 living neighbors stays alive.
export default {
  update({ alive, age }) {
    const crowd = alive.neighborSum()
    const next = alive.zip(crowd, (a, n) => (a ? n === 2 || n === 3 : n === 3) ? 1 : 0)
    return { alive: next, age: next.zip(age, (now, old) => (now ? old + 1 : 0)) }
  },
}

export const metrics = {
  population: ({ cells }) => cells.alive.sum(),
}
