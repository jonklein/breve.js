// Swimmers: fish that move by bending, in water the script makes.
//
// The physics engine has no water. What it has is forces, so this script works out what water would do to each part of a fish
// (the stdlib's Fluid: buoyancy while a part is under the surface, and drag that is much stronger across a flat part than along it)
// and returns it as `forces`. Nothing else pushes the fish. The thrust comes from the body bending in a wave that runs from head to tail:
// every segment, as it swings sideways, pushes water back, and the water pushes it forward.
//
//   wave      each joint bends a little after the one in front of it; the swing grows toward the tail
//   steer     bend the whole body one way and the fish turns that way
//   water     `data.water` says where the surface is (the picture reads it too, so there is one place to change it)
//
// Try: buoyancy a little under 1 (they sink and crawl along the bottom), drag at 0 (nothing to push against, so no swimming),
// the wave at 0 (the body just waggles), or a current.
const TURN_GAIN = 0.5 // radians of steady bend per unit of turn

export default {
  init: () => ({ cycle: 0, travelled: 0, height: 0, lastX: 0, lastZ: 0, started: false }),

  act({ self }, p, ctx) {
    const water = ctx.data.water

    // where do I want to go? an angle, 0 = +x, growing toward -z (the same as self.yaw)
    let want = self.row * 2.4 + p.wander * 1.5 * Math.sin(ctx.tick * 0.002 * (1 + (self.row % 3)))
    if (Math.hypot(self.x, self.z) > p.radius) want = Math.atan2(self.z, -self.x) // too far out? back toward the middle
    const off = Math.atan2(Math.sin(want - self.yaw), Math.cos(want - self.yaw))
    const turn = Math.max(-1, Math.min(1, off * p.steering))

    // a wave down the body: joint i is `wave` of a cycle behind joint i-1, and swings further toward the tail
    const joints = {}
    for (let i = 1; i <= 4; i++) {
      joints[`j${i}`] = ctx.gait.wave(self.cycle, { amplitude: p.amplitude * (0.5 + i / 4), phase: -p.wave * i, offset: turn * TURN_GAIN * (i / 4) })
    }

    // what the water does to every part, this tick; the surface is where the scene says, gravity is scaled by `buoyancy` (1 floats exactly as heavy as it is)
    const forces = ctx.fluid.forces(self.parts, {
      level: water.level, gravity: 9.81 * p.buoyancy, drag: p.drag, buoyancyHeight: 0.06, current: [p.current, 0, 0], dt: ctx.dt,
    })

    return {
      joints,
      forces,
      state: {
        cycle: ctx.gait.advance(self.cycle, p.frequency, ctx.dt),
        started: true,
        height: self.y,
        travelled: self.travelled + (self.started ? Math.hypot(self.x - self.lastX, self.z - self.lastZ) : 0),
        lastX: self.x,
        lastZ: self.z,
      },
    }
  },
}

export const metrics = {
  // average distance swum so far
  distance: ({ creatures }) => creatures.travelled.average(),
  // average speed right now
  speed: ({ creatures }) => creatures.speed.average(),
  // average height above the floor
  depth: ({ creatures }) => creatures.height.average(),
}
