// Ants foraging, the classic StarLogo way.
//
// Two kinds of thing share the world: ants (free agents) and the ground (a layer of cells).
//   - An ant wanders until it finds food, picks up one piece, and walks home to the nest.
//   - On the way home it lays scent on the ground. Scent spreads and slowly evaporates.
//   - Hungry ants follow the strongest scent they can sense, so a trail forms by itself.
// Ants never change the ground directly: they say what to `add` and it lands next step.

const NEST = [-12, 0, 0]

export const Ant = {
  init() {
    return { carrying: false }
  },

  act({ self }, p, ctx) {
    const hit = ctx.bounds.bounce(self.position, self.velocity, ctx.world.size) // the world has walls: bounce off them
    if (hit) self.place(hit)
    const wobble = ctx.vec(ctx.random() - 0.5, 0, ctx.random() - 0.5).times(p.wander)

    // heading home with food
    if (self.carrying) {
      const toNest = ctx.vec(...NEST).minus(self.position)
      if (toNest.length() < 2.5) {
        return { steer: wobble, state: { carrying: false }, add: { delivered: 1 } } // drop it off
      }
      return { steer: toNest.normalized().times(p.pull).plus(wobble), add: { scent: p.laying } }
    }

    // standing on food: take a piece and turn around
    if (self.patch && self.patch.food > 0) {
      return { steer: self.velocity.reversed(), state: { carrying: true }, add: { food: -1 } }
    }

    // looking for food: sniff three spots ahead and lean toward the strongest scent
    const heading = self.velocity.normalized()
    const probes = [0, 0.8, -0.8].map((turn) => heading.turned(turn).times(3))
    const scents = probes.map((spot) => (self.patchAt(spot) ? self.patchAt(spot).scent : 0))
    const best = Math.max(...scents)
    const lean = best > 0.05 ? probes[scents.indexOf(best)].normalized().times(p.pull) : ctx.vec(0, 0, 0)

    return { steer: lean.plus(wobble) }
  },
}

// the ground: where the nest and the food are, and the scent that spreads over it
const FOOD = [[11, 0, 8, 3], [5, 0, -13, 2.5]] // x, y, z, radius of each patch
const NEST_RADIUS = 2.5

export const Ground = {
  init({ at }, p, ctx) {
    const inside = (c, r) => at.minus(ctx.vec(c[0], c[1], c[2])).length() <= r
    return { food: FOOD.some((f) => inside(f, f[3])) ? 5 : 0, scent: 0, nest: inside(NEST, NEST_RADIUS), delivered: 0 }
  },

  // what to draw: the nest blue, food gold, scent green (brighter when stronger); bare ground is not drawn
  displayAll({ scent, food, nest }, p, ctx) {
    const look = food.gt(0).where(1, scent.gt(0.05).where(scent.div(4).min(1).div(3).add(1 / 3), -1))
    const shown = nest.where(0, look)
    return { visible: shown.ge(0), color: ctx.colors.rampField(['#4f86f7', '#2f5a3c', '#7be495', '#ffd34a'], shown.max(0)) }
  },

  actAll({ scent, food }, p) {
    // scent spreads into neighbors, then evaporates a little
    const mixed = scent.zip(scent.neighborAverage(), (s, around) => (s + (around - s) * p.spread) * p.evaporation)
    return { scent: mixed, food: food.max(0) }
  },
}

export const metrics = {
  delivered: ({ sets }) => sets.ground.delivered.sum(),
  carrying: ({ sets }) => sets.ants.carrying.sum(),
}
