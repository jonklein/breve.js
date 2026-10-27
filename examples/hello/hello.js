// The smallest simulation: sixty walkers that wander at random.
//
// Each tick, every walker is asked what it wants to do: `act` gets `self` (its own position and velocity) and returns `steer`, a push.
// A script never changes anything itself; it says what it wants and the engine does it, for everyone at once.
export default {
  act({ self }, p, ctx) {
    // a random push, a different one every tick (`ctx.random()` is the seeded random: never use Math.random)
    const wander = ctx.vec(ctx.random() - 0.5, ctx.random() - 0.5, ctx.random() - 0.5).times(p.wander)
    // and a soft wall, so they stay in the box
    return { steer: wander.plus(ctx.bounds.soft(self.position, ctx.world.size)) }
  },
}

// A number to watch: how far the walkers are from the middle, on average. It is drawn as a chart under the view.
export const metrics = {
  spread: ({ agents }) => agents.position.lengths().average(),
}
