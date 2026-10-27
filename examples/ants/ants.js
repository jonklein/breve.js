// Ants foraging, the classic StarLogo way.
//
// Four kinds of thing share the world, and the scene's `data` says where the nest and the food are:
//   - ants (free agents) wander until they find food, take one piece, and walk home to the nest;
//   - the nest and the food are entities too, each just holding a place (and, for food, what is left);
//   - the ground is a layer of cells that holds the scent.
// On the way home an ant lays scent on the ground. Scent spreads and slowly evaporates, and hungry ants follow
// the strongest scent they can sense, so a trail forms by itself.
// Ants never change the ground directly: they say what to `add` and it lands next step. They do not change the food
// either: an ant that has just taken a piece says so (`fresh`), and the food counts those ants nearby.

export const Ant = {
  init() {
    return { carrying: false, fresh: false, delivered: 0 }
  },

  act({ self, foods, nests }, p, ctx) {
    const hit = ctx.bounds.bounce(self.position, self.velocity, ctx.world.size) // the world has walls: bounce off them
    if (hit) self.place(hit)
    const wobble = ctx.vec(ctx.random() - 0.5, 0, ctx.random() - 0.5).times(p.wander)

    // heading home with food
    if (self.carrying) {
      const home = nests.nearest()
      const toNest = home.position.minus(self.position)
      if (toNest.length() < home.reach) {
        return { steer: wobble, state: { carrying: false, fresh: false, delivered: self.delivered + 1 } } // drop it off
      }
      return { steer: toNest.normalized().times(p.pull).plus(wobble), state: { fresh: false }, add: { scent: p.laying } }
    }

    // standing at food that is not used up: take a piece and turn around
    for (const food of foods) {
      if (food.amount > 0 && food.position.minus(self.position).length() < food.reach) {
        return { steer: self.velocity.reversed(), state: { carrying: true, fresh: true } }
      }
    }

    // looking for food: sniff three spots ahead and lean toward the strongest scent
    const heading = self.velocity.normalized()
    const probes = [0, 0.8, -0.8].map((turn) => heading.turned(turn).times(3))
    const scents = probes.map((spot) => (self.patchAt(spot) ? self.patchAt(spot).scent : 0))
    const best = Math.max(...scents)
    const lean = best > 0.05 ? probes[scents.indexOf(best)].normalized().times(p.pull) : ctx.vec(0, 0, 0)

    return { steer: lean.plus(wobble), state: { fresh: false } }
  },

  // the ant's picture is tinted: its own color, or the food's color while it carries a piece
  display({ self }, p, ctx) {
    return { color: self.carrying ? ctx.data.colors.food : ctx.data.colors.ant }
  },
}

// The nest: where it is and how wide, from the scene's `data.nest`. It never moves.
export const Nest = {
  init(self, p, ctx) {
    const nest = ctx.data.nest
    return { position: nest.at, reach: nest.reach }
  },
  display({ self }, p, ctx) {
    return { color: ctx.data.colors.nest, scale: self.reach * 1.6 }
  },
}

// A patch of food: `data.food` lists them (where, how wide, how much). It shrinks as ants take pieces and disappears when empty.
export const Food = {
  init({ index }, p, ctx) {
    const food = ctx.data.food[index]
    return { position: food.at, reach: food.reach, amount: food.amount, full: food.amount }
  },
  act({ self, ants }) {
    let taken = 0
    for (const ant of ants) if (ant.fresh && ant.position.minus(self.position).length() < self.reach) taken++
    if (taken) return { state: { amount: Math.max(0, self.amount - taken) } }
  },
  display({ self }, p, ctx) {
    if (self.amount <= 0) return { visible: false }
    return { color: ctx.data.colors.food, scale: self.reach * 1.1 * Math.sqrt(self.amount / self.full) }
  },
}

// the ground: the scent that spreads over it
export const Ground = {
  init() {
    return { scent: 0 }
  },

  // What to draw: the scent, more opaque where it is stronger, so bare ground simply shows through. The color is the scene's
  // `data.colors.scent`, so changing it is an edit to the scene, not to this script.
  //
  // This is the whole-set form: one call gets every cell's `scent` as a Field, and the arithmetic below works out an opacity
  // (0 to 1) for all of the cells at once, with no loop in the script.
  displayAll({ scent }, p, ctx) {
    const c = ctx.colors.hex(ctx.data.colors.scent)
    const n = scent.length
    const color = { r: new Float32Array(n).fill(c[0]), g: new Float32Array(n).fill(c[1]), b: new Float32Array(n).fill(c[2]) }
    // cells with next to no scent are not drawn at all, so their faint edges do not add up to a ghostly grid over the ground
    return { visible: scent.gt(0.02), color, opacity: scent.div(4).min(1) }
  },

  // The same picture as a per-cell `display`, which is easier to read: it is called once for each cell, and `self` holds that
  // one cell's numbers. It is slower on a big grid (a function call and a small object for every cell), so use it while learning
  // or for small sets. To try it, comment out `displayAll` above and uncomment this; a set uses one or the other.
  //
  // display({ self }, p, ctx) {
  //   if (self.scent <= 0.02) return { visible: false }
  //   return { color: ctx.data.colors.scent, opacity: Math.min(self.scent / 4, 1) }
  // },

  actAll({ scent }, p) {
    // scent spreads into neighbors, then evaporates a little
    return { scent: scent.zip(scent.neighborAverage(), (s, around) => (s + (around - s) * p.spread) * p.evaporation) }
  },
}

export const metrics = {
  delivered: ({ sets }) => sets.ants.delivered.sum(),
  carrying: ({ sets }) => sets.ants.carrying.sum(),
}
