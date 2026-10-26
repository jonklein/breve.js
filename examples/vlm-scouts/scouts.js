// Scouts that decide by looking.
//
// Each scout has a camera: a small top-down picture of its surroundings, turned so that "up" is the way it is
// heading (scene.json: `"sensors": [{ "type": "camera", "name": "view", ... }]`). Every 90 ticks its `think`
// shows that picture to a vision model with ctx.ask and asks where to go. It is never told where the food is:
// it has to see the green dot. The fast `act` then steers by the answer until the next one arrives.
//
// The model is reached through the local server (ANTHROPIC_API_KEY in .env). Without one the scouts just drift.
// Every answer is logged, so a run can be replayed without calling the model again.
export const Scout = {
  // what the model last said: how hard to turn (-1 left to 1 right) and how fast to go (0 to 1); zero until its first answer
  init() {
    return { turn: 0, go: 0 }
  },

  async think({ self, view }, p, ctx) {
    const reply = await ctx.ask(
      'You are a scout, the white dot in the middle of this top-down picture; the tick above it shows the way you face, and up is forward. ' +
        'Green is food, yellow are other scouts, and the dark border is the edge of the world. ' +
        'Reply with JSON like {"turn": 0.5, "go": 1}: turn is -1 (hard left) to 1 (hard right), go is 0 (stay) to 1 (full speed). ' +
        'If you cannot see any food, turn to look around.',
      { json: true, images: [view] },
    )
    const answer = JSON.parse(reply)
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0))
    return { turn: clamp(answer.turn, -1, 1), go: clamp(answer.go, 0, 1) }
  },

  act({ self }, p, ctx) {
    if (!self.turn && !self.go) return { steer: ctx.vec(ctx.random() - 0.5, 0, ctx.random() - 0.5).times(10) } // no answer yet: drift
    // forward is where the scout is heading; right is a quarter turn clockwise seen from above
    const heading = self.velocity.length() > 0.1 ? self.velocity.normalized() : ctx.vec(1, 0, 0)
    const right = ctx.vec(-heading.z, 0, heading.x)
    return { steer: heading.times(self.go * p.push).plus(right.times(self.turn * p.push)) }
  },
}

export const Food = { act: () => ({}) }

export const metrics = {
  // how far the scouts are from the food, on average
  distanceToFood: ({ sets }) => sets.scouts.position.minus(sets.food.position.average()).lengths().average(),
}
