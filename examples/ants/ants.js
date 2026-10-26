// Ants foraging, the classic StarLogo way.
//
// Two kinds of thing share the world: ants (free agents) and the ground (a layer of cells).
//   - An ant wanders until it finds food, picks up one piece, and walks home to the nest.
//   - On the way home it lays scent on the ground. Scent spreads and slowly evaporates.
//   - Hungry ants follow the strongest scent they can sense, so a trail forms by itself.
// Ants never change the ground directly: they say what to `add` and it lands next step.

const NEST = [-12, 0, 0]

export const Ant = {
  act({ self }, p, ctx) {
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

export const Ground = {
  actAll({ scent, food, nest }, p) {
    // scent spreads into neighbors, then evaporates a little
    const mixed = scent.zip(scent.neighborAverage(), (s, around) => (s + (around - s) * p.spread) * p.evaporation)
    const left = food.map((f) => Math.max(0, f))

    // what to draw: food is gold, scent is green (brighter when stronger), the nest is blue
    const look = mixed.zip(left, (s, f) => (f > 0 ? 1 : s > 0.05 ? 1 / 3 + Math.min(1, s / 4) / 3 : -1))
    const shown = look.zip(nest, (l, n) => (n ? 0 : l))
    return { scent: mixed, food: left, look: shown.map((l) => Math.max(0, l)), mark: shown.map((l) => (l >= 0 ? 1 : 0)) }
  },
}

export const metrics = {
  delivered: ({ sets }) => sets.ground.delivered.sum(),
  carrying: ({ sets }) => sets.ants.carrying.sum(),
}
