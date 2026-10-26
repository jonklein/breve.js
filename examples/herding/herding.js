// A sheepdog you drive yourself.
//
// Click the 3D view, then use W A S D (or the arrow keys) to run the dog. Sheep graze, stay near
// each other, and run from the dog. Herd them into the right-hand end (the "penned" chart counts them).
//
// Each behavior is a small function; ctx.blend adds their pushes together.

function graze({ self }, p, ctx) {
  // wander a little, and slow down a bit
  const wander = ctx.vec(ctx.random() - 0.5, 0, ctx.random() - 0.5).times(6)
  return { steer: wander.minus(self.velocity.times(0.8)) }
}

function stickTogether({ neighbors }, p) {
  if (neighbors.isEmpty()) return {}
  return { steer: neighbors.offset.average().times(p.flocking) } // toward the middle of nearby sheep
}

function runFromDog({ dogs }, p) {
  // away from each dog, harder when it is close
  return { steer: dogs.offset.map((o) => o.reversed().dividedBy(Math.max(1, o.lengthSquared()))).sum().times(p.fear) }
}

export const Sheep = {
  act(obs, p, ctx) {
    const hit = ctx.bounds.bounce(obs.self.position, obs.self.velocity, ctx.world.size) // the world has walls: bounce off them
    if (hit) obs.self.place(hit)
    return ctx.blend(graze(obs, p, ctx), stickTogether(obs, p), runFromDog(obs, p))
  },
}

export const Dog = {
  // a person is driving, so a replay will not reproduce this run unless the key presses are replayed too
  spec: { nondeterministic: true },

  act({ self }, p, ctx) {
    const hit = ctx.bounds.bounce(self.position, self.velocity, ctx.world.size) // the world has walls: bounce off them
    if (hit) self.place(hit)
    const key = (name) => (ctx.input.pressed(name) ? 1 : 0)
    const push = ctx.vec(
      key('d') + key('arrowright') - key('a') - key('arrowleft'),
      0,
      key('s') + key('arrowdown') - key('w') - key('arrowup'),
    )
    // brake when no key is held, so the dog stops instead of sliding
    return { steer: push.normalized().times(60).minus(self.velocity.times(push.length() ? 0 : 6)) }
  },
}

export const metrics = {
  // how spread out the flock is: average distance from its middle (lower is tighter)
  together: ({ sets }) => sets.sheep.position.minus(sets.sheep.position.average()).lengths().average(),
  // how many sheep have been driven into the right-hand end
  penned: ({ sets }) => sets.sheep.position.filter((s) => s.x > 16).length,
}
