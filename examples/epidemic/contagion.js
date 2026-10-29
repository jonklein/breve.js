// An epidemic spreading through connected things: S (0) susceptible, I (1) infected, R (2) recovered.
//
// This script does not know whether it is running on a network of people or a grid of cells.
// It only asks "who are my neighbors, and how many of them are infected?". Try it on both
// (this example and "Epidemic on a grid" share this exact file).
//
//   A susceptible one catches it from each infected neighbor with chance `infectiousness`.
//   An infected one recovers after `recoveryTime` ticks and cannot catch it again.
export default {
  // everyone starts susceptible but five random ones, who are infected. (`present` is only for the grid, which draws it.)
  initAll({ count }, p, ctx) {
    const status = new Float32Array(count)
    const order = Array.from({ length: count }, (_, i) => i)
    for (let i = 0; i < Math.min(5, count); i++) {
      const j = i + Math.floor(ctx.random() * (count - i))
      ;[order[i], order[j]] = [order[j], order[i]]
      status[order[i]] = 1
    }
    return { status, timer: new Float32Array(count), present: new Float32Array(count).fill(1) }
  },

  // susceptible blue, infected red, recovered green (on the grid, `present` says which cells are drawn)
  displayAll({ status, present }, p, ctx) {
    return { visible: present, color: ctx.colors.gradientField(['#2f6bff', '#ff2a3a', '#2fd16f'], status.div(2)) }
  },

  act({ self, neighbors }, p, ctx) {
    if (self.status === 0) {
      const sickNeighbors = neighbors.status.filter((s) => s === 1).length
      const chanceOfCatching = 1 - Math.pow(1 - p.infectiousness, sickNeighbors)
      return ctx.random() < chanceOfCatching ? { status: 1, timer: 0 } : {}
    }
    if (self.status === 1) {
      return self.timer + 1 >= p.recoveryTime ? { status: 2 } : { timer: self.timer + 1 }
    }
    return {}
  },
}

const count = (people, value) => people.status.filter((s) => s === value).length

export const metrics = {
  susceptible: ({ sets }) => count(sets.people, 0),
  infected: ({ sets }) => count(sets.people, 1),
  recovered: ({ sets }) => count(sets.people, 2),
}
