// Boids: every bird follows three simple rules.
//
//   cohesion    fly toward the other birds nearby
//   alignment   fly the same way they are flying
//   separation  don't crowd anyone
//   wander      a little random jitter, so flocks keep changing instead of settling into one ball
//
// The world has soft walls: the stdlib's Bounds.soft pushes a bird back toward the middle once it gets near the edge.
//
// `neighbors` is a whole group of birds, so you can ask it questions
// like neighbors.velocity.average() with no loops.

export default {
  act({ self, neighbors }, p, ctx) {
    const crowd = neighbors.within(p.separationRadius) // the birds that are too close

    const cohesion = neighbors.offset.average() // toward the middle of the group
    const alignment = neighbors.velocity.minus(self.velocity).average() // how they move compared to me
    const separation = crowd.offset.map((o) => o.reversed().dividedBy(o.lengthSquared())).sum() // away from each one, harder the closer they are

    const wander = ctx.vec(ctx.random() - 0.5, ctx.random() - 0.5, ctx.random() - 0.5) // a random push, a different one every tick

    return {
      steer: cohesion.times(p.cohesion)
        .plus(alignment.times(p.alignment))
        .plus(separation.times(p.separation))
        .plus(wander.times(p.wander))
        .plus(ctx.bounds.soft(self.position, ctx.world.size)),
    }
  },
}

// Numbers named in scene.json "metrics" are measured from all the birds.
export const metrics = {
  // 1 when everyone flies the same way, near 0 when it's chaos
  polarization: ({ agents }) => agents.velocity.normalized().average().length(),
}
