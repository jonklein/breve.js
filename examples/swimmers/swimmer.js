// Swimmers: fish that move by bending, in water the script makes.
//
// The physics engine has no water. What it has is forces, so this script works out what water would do to each part of a fish
// (the stdlib's Fluid: buoyancy while a part is under the surface, and drag that is much stronger across a flat part than along it)
// and returns it as `forces`. Nothing else pushes the fish forward. The thrust comes from the body bending in a wave that runs from head
// to tail: every segment, as it swings sideways, pushes water back, and the water pushes it forward. A broad tail pushes more water.
//
//   wave     each joint bends a little after the one in front of it; the swing grows toward the tail
//   steer    bend the whole body one way and the fish turns that way
//   depth    a fish rises and dives by changing how much it floats (a swim bladder), toward a depth that drifts slowly with time
//   water    `data.water` says where the surface is (the picture reads it too, so there is one place to change it)
//
// Three kinds of fish share this code and differ only in their bodies (in the scene) and the few numbers below:
// small quick minnows, big tuna with broad tails, and long eels that bend into many curves.
//
// Try: buoyancy a little under 1 (they sink and crawl along the bottom), drag at 0 (nothing to push against, so no swimming),
// the wave at 0 (the body just waggles), or a current.
const TURN_GAIN = 0.5 // radians of steady bend per unit of turn
const FLOOR = 0.5 // how close to the bottom a fish dives, metres
const SURFACE = 0.7 // and how close to the surface it rises

/** One kind of fish: how fast it beats its tail, how far its body swings, how many body curves it shows at once, and how far it dives. */
function fish({ beat, swing, curves, dive }) {
  return {
    init: () => ({ cycle: 0, travelled: 0, height: 0, lastX: 0, lastZ: 0, started: false }),

    act({ self }, p, ctx) {
      const water = ctx.data.water
      const joints = Object.keys(self.joints)

      // where do I want to go? an angle, 0 = +x, growing toward -z (the same as self.yaw)
      let want = self.row * 2.4 + p.wander * 1.5 * Math.sin(ctx.time * 0.12 * (1 + (self.row % 3)))
      if (Math.hypot(self.x, self.z) > p.radius) want = Math.atan2(self.z, -self.x) // too far out? back toward the middle
      const off = Math.atan2(Math.sin(want - self.yaw), Math.cos(want - self.yaw))
      const turn = Math.max(-1, Math.min(1, off * p.steering))

      // a wave down the body: joint i lags the one in front, and swings further toward the tail
      const targets = {}
      joints.forEach((name, i) => {
        const along = (i + 1) / joints.length
        targets[name] = ctx.gait.wave(self.cycle, { amplitude: p.amplitude * swing * (0.45 + along), phase: -(p.wave * curves) / joints.length * (i + 1), offset: turn * TURN_GAIN * along })
      })

      // the depth this fish is after drifts between the bottom and the surface, a different way for each fish; a swim bladder gets it there
      const low = FLOOR, high = water.level - SURFACE
      const mood = 0.5 + 0.5 * (0.6 * Math.sin(ctx.time * 0.11 + self.row * 1.9) + 0.4 * Math.sin(ctx.time * 0.047 + self.row * 0.7))
      const target = low + (high - low) * (0.5 + (mood - 0.5) * p.depthRange * dive)
      const bladder = Math.max(-0.35, Math.min(0.35, 0.5 * (target - self.y) - 0.9 * self.vy)) // how much lighter (+) or heavier (-) than neutral

      // what the water does to every part, this tick
      const forces = ctx.fluid.forces(self.parts, {
        level: water.level, gravity: 9.81 * p.buoyancy * (1 + bladder), drag: p.drag, buoyancyHeight: 0.06, current: [p.current, 0, 0], dt: ctx.dt,
      })

      return {
        joints: targets,
        forces,
        state: {
          cycle: ctx.gait.advance(self.cycle, p.frequency * beat, ctx.dt),
          started: true,
          height: self.y,
          travelled: self.travelled + (self.started ? Math.hypot(self.x - self.lastX, self.z - self.lastZ) : 0),
          lastX: self.x,
          lastZ: self.z,
        },
      }
    },
  }
}

export const minnow = fish({ beat: 1.3, swing: 1, curves: 1, dive: 1 })
export const tuna = fish({ beat: 1, swing: 0.9, curves: 0.8, dive: 0.6 })
export const eel = fish({ beat: 0.42, swing: 0.8, curves: 2.2, dive: 0.8 })

// the numbers over all fish of all kinds
const mean = (sets, field) => {
  let sum = 0, n = 0
  for (const group of Object.values(sets)) if (group.length) { sum += group[field].sum(); n += group.length }
  return n ? sum / n : 0
}

export const metrics = {
  // average distance swum so far (path length)
  distance: ({ sets }) => mean(sets, 'travelled'),
  // average speed right now
  speed: ({ sets }) => mean(sets, 'speed'),
  // average height above the floor
  depth: ({ sets }) => mean(sets, 'height'),
}
