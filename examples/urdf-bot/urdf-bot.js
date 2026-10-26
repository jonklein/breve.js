// A walking gait for a robot that came from a URDF file.
//
// The body (scene.json) was converted from robot.urdf, so it has no built-in "drive" like the creature
// example. Here the script plays the part of the leg muscles: every tick it names an angle for each hip
// and knee. Joint names come straight from the URDF (FL_hip, FL_knee, ...). Diagonal legs move together.
const PHASE = { FL: 0, HR: 0, FR: 0.5, HL: 0.5 }

export default {
  onLeave({ self }) { self.reset() },

  act({ self }, p, ctx) {
    if (self.downFor > 3) self.reset()
    const joints = {}
    for (const leg of Object.keys(PHASE)) {
      const cycle = ctx.tick / 60 * p.frequency + PHASE[leg] // how far through its step this leg is
      joints[`${leg}_hip`] = p.stride * Math.sin(2 * Math.PI * cycle)
      // bend the knee while the leg swings forward
      joints[`${leg}_knee`] = -0.9 - p.lift * 0.5 * (1 + Math.sin(2 * Math.PI * (cycle - 0.25))) * 0.5
    }
    return { joints }
  },
}

export const metrics = {
  distance: ({ creatures }) => creatures.travelled.average(),
}
