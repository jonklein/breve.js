// Braitenberg vehicles, physically simulated.
//
// Valentino Braitenberg's thought experiment (Vehicles, 1984): a little cart with two light sensors and two motors, and nothing else.
// Connect the sensors to the motors in different ways and the carts seem to have different characters: one swerves away from lights, one swerves toward them,
// one slows as it nears one and settles in front of it, one heads for a light and then swerves off. There is no goal or plan in any of them, only wiring.
//
// Here the carts are real: a chassis on four wheels, the two on each side driven together, on a floor with friction, bumping into each other. The script is the wiring:
//
//   eye      how much light each sensor sees: lights nearby and in front of that eye count most
//   wiring   `data.kinds[...].weights[motor][eye]` says how much each eye pushes each motor (negative slows it); `bias` is each motor's resting drive
//   motors   the wheels are told how fast to turn, and the physics does the rest
//
// The lights are in the scene's `data.lights`; `world.markers` names that list, so the poles you see are the lights the carts sense.
const WHEEL = 0.16 // wheel radius, metres
const EYE = { ahead: 0.28, apart: 0.15 } // where the eyes sit on the chassis: this far forward, this far to each side
const KD_OVER_KP = 6 / 20 // the motors are springs with damping; aiming this far ahead of the wheel's angle makes them hold a speed (damping / stiffness)

/** What one eye sees: each light's glow falls off with distance and counts for most when it is straight ahead of that eye. */
function eye(self, side, lights, p) {
  const yaw = self.yaw
  const fx = Math.cos(yaw), fz = -Math.sin(yaw) // the way the cart faces
  const rx = -fz, rz = fx // its right-hand side
  const turn = (side * p.squint * Math.PI) / 180 // this eye looks a little outward
  const ax = fx * Math.cos(turn) + rx * Math.sin(turn), az = fz * Math.cos(turn) + rz * Math.sin(turn)
  const ex = self.x + fx * EYE.ahead + rx * side * EYE.apart, ez = self.z + fz * EYE.ahead + rz * side * EYE.apart
  let seen = 0
  let nearest = Infinity
  for (const light of lights) {
    const dx = light.at[0] - ex, dz = light.at[1] - ez
    const d = Math.hypot(dx, dz)
    nearest = Math.min(nearest, d)
    const facing = Math.max(0, (dx * ax + dz * az) / (d || 1)) // 1 straight ahead of the eye, 0 side-on or behind
    seen += (light.power ?? 1) * facing * facing / (1 + (d / p.range) ** 2)
  }
  return { seen, nearest }
}

export default {
  init: ({ index }, p, ctx) => ({ kind: index % ctx.data.kinds.length, near: 0, flippedFor: 0 }),

  act({ self }, p, ctx) {
    const { kinds, lights, arena } = ctx.data
    const kind = kinds[self.kind]
    const left = eye(self, -1, lights, p), right = eye(self, 1, lights, p)
    const sees = [Math.min(1, left.seen), Math.min(1, right.seen)] // how bright it is at each eye, 0 to 1

    // the wiring: each motor is its resting drive plus what the eyes push it, scaled by `gain`, plus a little noise (real motors are not exact, and it frees carts that jam each other)
    const drive = [0, 1].map((m) => {
      const u = (kind.bias?.[m] ?? 0) + p.gain * (kind.weights[m][0] * sees[0] + kind.weights[m][1] * sees[1]) + p.noise * (ctx.random() * 2 - 1)
      return Math.max(0, Math.min(1, u))
    })

    // a wheel turns at the speed the motor asks for; a hinge that turns this way drives the cart backward, so the sign is flipped
    const spin = drive.map((d) => (-d * p.speed) / WHEEL)
    // four wheels, driven in pairs: both on the left from the left motor, both on the right from the right one (the cart turns by skidding)
    const aim = (name, motor) => self.joints[name] + spin[motor] * KD_OVER_KP
    const joints = { wheelFL: aim('wheelFL', 0), wheelBL: aim('wheelBL', 0), wheelFR: aim('wheelFR', 1), wheelBR: aim('wheelBR', 1) }

    // the arena has an invisible wall: a cart that reaches it is put back a little inside, facing the middle; so is one that has been flipped over
    const flippedFor = self.up.y < 0.4 ? self.flippedFor + 1 : 0
    let place = null
    if (Math.abs(self.x) > arena || Math.abs(self.z) > arena || flippedFor > 120) {
      const x = Math.max(-arena + 2, Math.min(arena - 2, self.x)), z = Math.max(-arena + 2, Math.min(arena - 2, self.z))
      place = { x: flippedFor > 120 ? (ctx.random() * 2 - 1) * (arena - 3) : x, z: flippedFor > 120 ? (ctx.random() * 2 - 1) * (arena - 3) : z, yaw: Math.atan2(-(0 - z), 0 - x) }
    }
    return { joints, place, state: { near: Math.min(left.nearest, right.nearest), flippedFor: place ? 0 : flippedFor } }
  },
}

// how far each kind of cart is from its nearest light, on average
const byKind = (creatures, name, kinds) => {
  const k = kinds.findIndex((x) => x.name === name)
  const rows = []
  for (let i = 0; i < creatures.kind.length; i++) if (creatures.kind[i] === k) rows.push(creatures.near[i])
  return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0
}
const KINDS = ['fear', 'aggression', 'love', 'explorer']
export const metrics = Object.fromEntries(KINDS.map((name) => [name, ({ creatures }) => byKind(creatures, name, [{ name: 'fear' }, { name: 'aggression' }, { name: 'love' }, { name: 'explorer' }])]))
