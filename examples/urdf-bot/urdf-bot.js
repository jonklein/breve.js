// A walking gait for a robot that came from a URDF file.
//
// The body (scene.json) was converted from robot.urdf. Here the script plays the part of the leg muscles: every
// tick it names an angle for each hip and knee. Joint names come straight from the URDF (FL_hip, FL_knee, ...).
// Diagonal legs move together. It also stands a robot back up if it has been flipped for 3 seconds or fallen off.
const PHASE = { FL: 0, HR: 0, FR: 0.5, HL: 0.5 }

export default {
  init: () => ({ flippedFor: 0, started: false, travelled: 0, lastX: 0, lastZ: 0 }),

  act({ self }, p, ctx) {
    const flippedFor = self.up.y < 0.3 ? self.flippedFor + 1 : 0
    let placed = null
    if (flippedFor > 180 || self.y < -20) {
      placed = { x: (ctx.random() * 2 - 1) * 10, z: (ctx.random() * 2 - 1) * 10 }
      self.place({ ...placed, yaw: ctx.random() * 2 * Math.PI })
    }
    const joints = {}
    for (const leg of Object.keys(PHASE)) {
      const cycle = ctx.tick / 60 * p.frequency + PHASE[leg] // how far through its step this leg is
      joints[`${leg}_hip`] = p.stride * Math.sin(2 * Math.PI * cycle)
      // bend the knee while the leg swings forward
      joints[`${leg}_knee`] = -0.9 - p.lift * 0.5 * (1 + Math.sin(2 * Math.PI * (cycle - 0.25))) * 0.5
    }
    return {
      joints,
      state: {
        flippedFor: placed ? 0 : flippedFor,
        started: true,
        travelled: self.travelled + (self.started && !placed ? Math.hypot(self.x - self.lastX, self.z - self.lastZ) : 0),
        lastX: placed ? placed.x : self.x,
        lastZ: placed ? placed.z : self.z,
      },
    }
  },
}

export const metrics = {
  distance: ({ creatures }) => creatures.travelled.average(),
}
