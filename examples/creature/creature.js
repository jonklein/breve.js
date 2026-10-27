// Creatures: four-legged walkers on bumpy ground.
//
// The legs swing in a rhythm that this script works out each tick (the stdlib's Gait: a sine per joint, started at
// different points of one shared cycle; try the phase sliders for other gaits). The script keeps its place in the cycle in its
// own state, so changing the step rate never makes the legs jump. That walks in a straight line, so the script also steers:
//
//   wander    each creature slowly changes its mind about where to go
//   go home   too far from the middle? head back
//   turn      take longer strides on one side than the other
//
// A joint the script leaves out rests at 0. Everything else the world might do for a creature is done here too:
// a creature that has been flipped over for 3 seconds, or has fallen off the edge, is stood up somewhere new (act returns `place`).

const SECOND = 60 // ticks

// which point of the cycle each leg starts at (diagonal pairs move together), and the shape of a leg's hip and knee swing
function legs(p) {
  const out = {}
  for (const [leg, phase] of [['FL', 0], ['FR', p.diagonal], ['HL', p.diagonal], ['HR', p.hindOffset]]) {
    out[`${leg}.hip`] = { amplitude: p.stride, phase }
    out[`${leg}.knee`] = { amplitude: p.lift, offset: -0.9, phase, lag: p.kneeLag }
  }
  return out
}

export default {
  // what each creature remembers: where it is in the step cycle, and how long it has been flipped over
  init: () => ({ cycle: 0, flippedFor: 0, started: false, travelled: 0, lastX: 0, lastZ: 0 }),

  act({ self }, p, ctx) {
    // a creature that fell off the edge of the world, or lay flipped for 3 seconds, is stood up at a new spot
    const flippedFor = self.up.y < 0.3 ? self.flippedFor + 1 : 0
    let placed = null
    if (flippedFor > 3 * SECOND || self.y < -20) {
      const spot = () => (ctx.random() * 2 - 1) * p.radius
      placed = { x: spot(), z: spot(), yaw: ctx.random() * 2 * Math.PI }
    }

    // where do I want to go? an angle, 0 = +x, growing toward -z (the same as self.yaw)
    let want = self.row * 2.4 + p.wander * 1.5 * Math.sin(ctx.tick * 0.002 * (1 + (self.row % 3)))
    if (Math.hypot(self.x, self.z) > p.radius) want = Math.atan2(self.z, -self.x) // toward the middle

    // how far off am I? wrap to -pi..pi, then squash to -1 (turn right) .. 1 (turn left)
    const off = Math.atan2(Math.sin(want - self.yaw), Math.cos(want - self.yaw))
    const turn = Math.max(-1, Math.min(1, off * p.steering))

    // longer strides on the right turn me left, and the other way around
    const joints = ctx.gait.targets(legs(p), self.cycle)
    for (const name of Object.keys(joints)) {
      const [leg, joint] = name.split('.') // joint names look like "FL.hip": front-left leg, hip joint
      if (joint === 'hip') joints[name] *= 1 + 0.5 * (leg.endsWith('R') ? turn : -turn)
    }

    return {
      joints,
      place: placed,
      state: {
        cycle: ctx.gait.advance(self.cycle, p.frequency, ctx.dt),
        flippedFor: placed ? 0 : flippedFor,
        started: true,
        // distance walked: each tick's step, but not the jump when it is stood up somewhere new
        travelled: self.travelled + (self.started && !placed ? Math.hypot(self.x - self.lastX, self.z - self.lastZ) : 0),
        lastX: placed ? placed.x : self.x,
        lastZ: placed ? placed.z : self.z,
      },
    }
  },
}

export const metrics = {
  // average distance walked so far
  distance: ({ creatures }) => creatures.travelled.average(),
  // average walking speed right now
  speed: ({ creatures }) => creatures.speed.average(),
}
