---
title: How a simulation is written
summary: Four small hooks, a rule that nothing changes behind your back, and a toolbox.
---

A script exports a **controller**: an object with up to four functions.

| hook | when it runs | what it returns |
|---|---|---|
| `init` | once, as each thing is made | what it starts as: `{ hunger: 0 }` |
| `act` | every tick | what it wants to do: a `steer`, and any new state |
| `think` | every so often, slowly (it may ask a language model) | what it decided, as state |
| `display` | when drawing | how it looks: a color, a size |

## The one rule

**A script never changes anything. It returns what it wants, and the engine does it for everyone at once.** Every walker sees the world as it was at the start of the tick, so the order they are asked in makes no difference. It is also why runs can be repeated exactly, copied mid-run, and replayed.

## Keeping state

Whatever `init` returns becomes the thing's state, readable as `self.hunger`. To change it, return the new value from `act`:

```js
export default {
  init() { return { hunger: 0 } },

  act({ self }, p, ctx) {
    const wander = ctx.vec(ctx.random() - 0.5, ctx.random() - 0.5, ctx.random() - 0.5).times(p.wander)
    return {
      steer: wander.plus(ctx.bounds.soft(self.position, ctx.world.size)),
      state: { hunger: self.hunger + 1 },
    }
  },

  display({ self }, p, ctx) {
    // blue when fresh, red when hungry
    return { color: ctx.colors.gradient(['#4f86f7', '#ff5a4d'], self.hunger / 300) }
  },
}
```

Paste that over `script.js` in the Hello example: the walkers turn from blue to red as the ticks go by.

## Looking at others

Things that move freely can see their neighbors. In **Boids** the rule is a few lines about the group of birds nearby:

```js
const cohesion = neighbors.offset.average()                     // toward the middle of the group
const alignment = neighbors.velocity.minus(self.velocity).average()  // how they move compared to me
```

Groups answer questions like `neighbors.velocity.average()` with no loops.

## The toolbox

- `ctx.random()`: the seeded random number. **Never use `Math.random()`**: a run must come out the same every time.
- `ctx.vec(x, y, z)` makes a vector; vectors have `plus`, `minus`, `times`, `length`, `normalized` and more, and always make a new one.
- `p.name` is the current value of the slider called `name`.
- `ctx.tick` is the tick number. `ctx.bounds` keeps things in a box, `ctx.colors` makes colors.
- `export const metrics = { spread: ({ agents }) => ... }` names a number to chart; list its name under `metrics` in the scene.

The full list is the script reference, `docs/script-api.md` in the repository.

Next: [other kinds of worlds](#/04-other-kinds-of-worlds).
