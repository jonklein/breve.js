// Every agent has its own little brain: a neural network with 11 inputs, 5 hidden cells and 8 outputs.
//
// The brain sees: where the nearest neighbor is, how fast the agent is going, and its own `memory`
// (5 numbers it wrote on the previous tick). It answers with a push (3 numbers) and a new memory (5 numbers).
// The weights are random, so this is a crowd of strange wanderers. They are state like any other,
// so forking or snapshotting a run keeps every brain exactly as it was.
export default {
  // random weights, spread 0.7 around zero, and an empty memory
  init(self, p, ctx) {
    return { weights: Float32Array.from({ length: 108 }, () => 0.7 * ctx.normal()), memory: [0, 0, 0, 0, 0] }
  },

  act({ self, neighbors }, p, ctx) {
    const brain = ctx.mlp([11, 5, 8])

    const near = neighbors.nearest()
    const toNear = near ? near.position.minus(self.position).dividedBy(p.radius) : ctx.vec(0, 0, 0)
    const speed = self.velocity.dividedBy(p.maxSpeed)

    const seen = [...toNear.toArray(), ...speed.toArray(), ...self.memory]
    const [x, y, z, ...memory] = brain.run(self.weights, seen)

    return {
      steer: ctx.vec(x, y, z).times(p.push),
      state: { memory },
    }
  },
}

export const metrics = {
  // how far from the middle the crowd has drifted, on average
  spread: ({ agents }) => agents.position.lengths().average(),
}
