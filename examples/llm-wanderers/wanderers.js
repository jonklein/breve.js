// Five characters that let a language model decide where to go.
//
// Every 120 ticks each wanderer's `think` runs. It describes what the character can see in plain words,
// asks the model with ctx.ask, and returns the model's answer as state (dx, dz). The fast `act` then steers by that answer
// until the next one arrives. Thinking runs beside the simulation, so a slow model never freezes it.
//
// The model is reached through the local server (it needs ANTHROPIC_API_KEY in .env). Without one, the
// wanderers just drift. Every answer is logged with the tick it landed on, so a run can be replayed
// without asking the model again (see "decisionLog" and "replay" in docs/script-api.md).
const FOOD = [14, 0, 0]

export const Wanderer = {
  // what the model last advised: a direction to walk (zero until its first answer)
  init() {
    return { dx: 0, dz: 0 }
  },

  async think({ self }, p, ctx) {
    const toFood = ctx.vec(...FOOD).minus(self.position)
    const reply = await ctx.ask(
      `You are a hungry creature in a flat field, 40 steps wide. You stand at x=${self.x.toFixed(0)}, z=${self.z.toFixed(0)}. ` +
        `There is food ${toFood.length().toFixed(0)} steps away, ${toFood.x >= 0 ? 'east' : 'west'} and ${toFood.z >= 0 ? 'south' : 'north'} of you. ` +
        `Pick a direction to walk. Answer with JSON like {"dx": 1, "dz": 0} where dx is east (+) or west (-) and dz is south (+) or north (-), each between -1 and 1.`,
      { json: true },
    )
    const answer = JSON.parse(reply)
    return { dx: Number(answer.dx) || 0, dz: Number(answer.dz) || 0 }
  },

  act({ self }, p, ctx) {
    const hit = ctx.bounds.bounce(self.position, self.velocity, ctx.world.size) // the world has walls: bounce off them
    if (!self.dx && !self.dz) return { steer: ctx.vec(ctx.random() - 0.5, 0, ctx.random() - 0.5).times(10), place: hit } // no advice yet: drift
    return { steer: ctx.vec(self.dx, 0, self.dz).times(p.push), place: hit }
  },
}

export const Food = { act: () => ({}) }

export const metrics = {
  // how far the wanderers are from the food, on average (the food stands still at x = 14)
  distanceToFood: ({ sets }) => sets.wanderers.position.minus(sets.food.position.average()).lengths().average(),
}
