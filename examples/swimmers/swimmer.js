// Swimmers: fish that move by bending, in water the script makes.
//
// The physics engine has no water. What it has is forces, so this script works out what water would do to each part of a fish
// (the stdlib's Fluid: buoyancy while a part is under the surface, drag that is much stronger across a flat part than along it, and added mass:
// the water a part has to push along as it speeds up, which is what makes a broad tail a good paddle)
// and returns it as `forces`. Nothing else pushes the fish forward. The thrust comes from the body bending in a wave that runs from head
// to tail: every segment, as it swings sideways, pushes water back, and the water pushes it forward. A broad tail pushes more water.
//
//   wave     each joint bends a little after the one in front of it; the swing grows toward the tail
//   steer    bend the neck one way and the fish turns that way; the wave behind it stays symmetric
//   depth    a fish tilts its nose up or down to rise or dive, and its own thrust carries it that way, toward a depth that drifts slowly with time
//   water    `data.water` says where the surface is (the picture reads it too, so there is one place to change it)
//
// Three kinds of fish share this code and differ only in their bodies (in the scene) and the few numbers below:
// small quick minnows, big tuna with broad tails, and long eels that bend into many curves.
//
// Try: buoyancy a little under 1 (they sink and crawl along the bottom), drag at 0 (nothing to push against, so no swimming),
// the wave at 0 (the body just waggles), or a current.
const TURN_GAIN = 0.45 // radians the neck bends toward the way it wants to turn (the rest of the wave stays symmetric)
const FLOOR = 0.5 // how close to the bottom a fish dives, metres
const MAX_PITCH = 0.55 // the steepest it tilts, radians
const SURFACE = 0.7 // and how close to the surface it rises

/** One kind of fish: how fast it beats its tail, how far its body swings, how many body curves it shows at once, and how far it dives. */
function fish({ beat, swing, curves, dive, parts }) {
  return {
    // `wake` is what the water needs remembered from one tick to the next (each part's velocity and the added-mass force on it), for added mass
    init: () => ({ cycle: 0, travelled: 0, height: 0, lastX: 0, lastZ: 0, started: false, wake: new Array(1 + 6 * parts).fill(0) }),

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
        targets[name] = ctx.gait.wave(self.cycle, { amplitude: p.amplitude * swing * (0.45 + along), phase: -(p.wave * curves) / joints.length * (i + 1), offset: i === 0 ? turn * TURN_GAIN : 0 })
      })

      // the depth this fish is after drifts between the bottom and the surface, a different way for each fish; fins gets it there
      const low = FLOOR, high = water.level - SURFACE
      const mood = 0.5 + 0.5 * (0.6 * Math.sin(ctx.time * 0.11 + self.row * 1.9) + 0.4 * Math.sin(ctx.time * 0.047 + self.row * 0.7))
      const target = low + (high - low) * (0.5 + (mood - 0.5) * p.depthRange * dive)
      // tilt toward that depth: the nose goes up when the fish is below it and down when above, and a damping term stops it overshooting. The tilt
      // is a pair of fins' worth of torque, spread over the whole body; the swimming thrust, now pointing a little up or down, does the rest.
      const f = self.forward, flat = Math.hypot(f.x, f.z) || 1
      const pitch = Math.asin(Math.max(-1, Math.min(1, f.y)))
      const wanted = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, 0.9 * (target - self.y) - 1.2 * self.vy))
      const axis = [-f.z / flat, 0, f.x / flat] // sideways, so that turning about it lifts the nose
      const parts = Object.values(self.parts)
      const mass = parts.reduce((a, q) => a + q.mass, 0)
      const length = parts.reduce((a, q) => a + q.size[0], 0)
      const inertia = (mass * length * length) / 12 // roughly: a rod
      const spin = parts[0].angularVelocity
      const turning = spin.x * axis[0] + spin.z * axis[2]
      const couple = 4 * inertia * (wanted - pitch) - 4 * inertia * turning // responds over about a second, without ringing

      // and keep upright: a fish that rolls onto its side is turned back (the axis that carries its up toward the world's up, kept to the roll about its own length)
      const u = self.up
      const rollError = u.x * f.z - u.z * f.x // (up x world up) . forward: positive when it has rolled one way, negative the other
      const rolling = spin.x * f.x + spin.y * f.y + spin.z * f.z
      const rollCouple = inertia * 0.15 * (6 * rollError - 3 * rolling)

      // what the water does to every part, this tick, and the tilting couple added to it
      const forces = ctx.fluid.forces(self.parts, {
        level: water.level, gravity: 9.81 * p.buoyancy, drag: p.drag, buoyancyHeight: 0.03, addedMass: p.addedMass, current: [p.current, 0, 0], dt: ctx.dt,
      }, self.wake)
      for (const [name, q] of Object.entries(self.parts)) {
        const share = (couple * q.mass) / mass
        const roll = (rollCouple * q.mass) / mass
        forces[name].torque[0] += share * axis[0] + roll * f.x
        forces[name].torque[1] += roll * f.y
        forces[name].torque[2] += share * axis[2] + roll * f.z
      }

      return {
        joints: targets,
        forces,
        state: {
          cycle: ctx.gait.advance(self.cycle, p.frequency * beat, ctx.dt),
          started: true,
          wake: ctx.fluid.remember(self.parts, forces),
          height: self.y,
          travelled: self.travelled + (self.started ? Math.hypot(self.x - self.lastX, self.z - self.lastZ) : 0),
          lastX: self.x,
          lastZ: self.z,
        },
      }
    },
  }
}

export const minnow = fish({ beat: 1.1, swing: 1, curves: 1, dive: 1, parts: 5 })
export const tuna = fish({ beat: 0.85, swing: 0.9, curves: 1, dive: 0.6, parts: 5 })
export const eel = fish({ beat: 0.8, swing: 1.1, curves: 1.6, dive: 0.8, parts: 9 })

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
