// Agents steered by a trained network, run as one batch for the whole crowd.
//
// scene.json declares the model: `"models": { "policy": { "url": "policy.onnx" } }` (a path, a URL, or a Hugging Face file
// such as "hf:owner/repo/policy.onnx"). The host loads it, and `thinkAll` runs once a tick for every walker:
// one call to ctx.model('policy').runBatch for all of them, not one call each. The answers are logged like any
// other decision, so a run can be saved and replayed with no model and no ONNX runtime at all.
//
// The network takes [x/20, z/20, vx/6, vz/6] and answers [dx, dz]. `make_policy.py` writes the one used here, but any
// ONNX file with that input and output shape works, for example one you trained.
export default {
  async thinkAll(agents, p, ctx) {
    const seen = agents.map(({ self }) => [self.x / 20, self.z / 20, self.vx / 6, self.vz / 6])
    const out = await ctx.model('policy').runBatch(seen)
    return out.map(([dx, dz]) => ({ dx, dz }))
  },

  decide({ self }, p) {
    const d = self.decision // the network's last answer, or undefined before the first
    return d ? { steer: [d.dx * p.push, 0, d.dz * p.push] } : {}
  },
}

export const metrics = {
  // how far from the middle the walkers are, on average: the network pulls them in to a ring
  meanRadius: ({ agents }) => agents.position.lengths().average(),
}
