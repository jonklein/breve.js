---
title: Change something
summary: Edit the scene and the script in the editor drawer, and see the run change as you type.
---

Every simulation is two small files: a **scene** (the setup and the knobs, written as JSON) and a **script** (what the things in it do, written in JavaScript). Both are editable in the workbench.

## Open the editor

Click the **Editor** tab on the left edge, press **E**, or click **Editor** in the header. It slides out over the picture; drag its right edge to make it wider, and press **Esc** or click the tab again to put it away. It has tabs for `scene.json`, `script.js` and `experiment.json`.

## Edit the scene

`scene.json` opens as a tree. Find `entities`, open the first one, and change `count` from 60 to 300. The run restarts with 300 walkers. Switch to the text view (**Text view**) if you prefer to type JSON; the two stay in step.

Under `params` is the slider you were just using. Change its `value` (where the slider starts), `min` or `max`, or add another one: any number you put in `params` becomes a slider, and your script reads it as `p.name`.

If you make a mistake, the problems list says what and where in words, and the last good version keeps running.

## Edit the script

Open `script.js`. The heart of it is one function:

```js
act({ self }, p, ctx) {
  const wander = ctx.vec(ctx.random() - 0.5, ctx.random() - 0.5, ctx.random() - 0.5).times(p.wander)
  return { steer: wander.plus(ctx.bounds.soft(self.position, ctx.world.size)) }
}
```

Every tick, every walker gets this call. `self` is the walker, `p` the sliders, `ctx` a toolbox. It returns a **steer**: a push. Try:

- Delete `.plus(ctx.bounds.soft(...))`. With no wall, walkers escape the box.
- Change `ctx.random() - 0.5` in the middle term to `0`. The walkers now wander only in two directions.
- Add `.plus(self.velocity.times(-0.5))` after `wander`. That is friction: they slow down.

The simulation updates a moment after you stop typing. **Restore example** (next to the project name) puts the original back whenever you want.

Next: [how a simulation is written](#/03-how-a-simulation-is-written).
