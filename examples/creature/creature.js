// Creatures: four-legged walkers on bumpy ground.
//
// The legs already walk by themselves: every leg joint in scene.json has a "drive", and the built-in
// oscillator swings them in a rhythm (try the phase sliders for other gaits). That walks in a
// straight line, so this script only steers.
//
//   wander    each creature slowly changes its mind about where to go
//   go home   too far from the middle? head back
//   turn      take longer strides on one side than the other
//
// self.gait is what the oscillator wants each joint to do right now. Returning
// { joints: { name: angle } } overrides those motors; any joint you leave out keeps its gait.

export default {
  decide({ self }, p, ctx) {
    // where do I want to go? an angle, 0 = +x, growing toward -z (the same as self.yaw)
    let want = self.row * 2.4 + p.wander * 1.5 * Math.sin(ctx.tick * 0.002 * (1 + (self.row % 3)))
    if (Math.hypot(self.x, self.z) > p.radius) want = Math.atan2(self.z, -self.x) // toward the middle

    // how far off am I? wrap to -pi..pi, then squash to -1 (turn right) .. 1 (turn left)
    const off = Math.atan2(Math.sin(want - self.yaw), Math.cos(want - self.yaw))
    const turn = Math.max(-1, Math.min(1, off * p.steering))

    // longer strides on the right turn me left, and the other way around
    const joints = {}
    for (const [name, angle] of Object.entries(self.gait)) {
      const [leg, joint] = name.split('.') // joint names look like "FL.hip": front-left leg, hip joint
      if (joint !== 'hip') continue
      const rightSide = leg.endsWith('R')
      joints[name] = angle * (1 + 0.5 * (rightSide ? turn : -turn))
    }
    return { joints }
  },
}

export const metrics = {
  // average distance walked so far
  distance: ({ creatures }) => creatures.travelled.average(),
  // average walking speed right now
  speed: ({ creatures }) => creatures.speed.average(),
}
