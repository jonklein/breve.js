---
title: Making it fast
summary: Per-thing rules for learning, whole-grid rules for big grids, and formulas that run on a graphics card.
---

Writing `act` for one thing at a time is the easiest way to think, and costs about three millionths of a second a thing: fine for tens of thousands. For more, a script can describe the *whole set* at once.

## `actAll`: the whole grid in one go

Instead of `act`, a lattice script may give `actAll`, which receives each state field as a whole and returns the new fields, with no loop over cells:

```js
actAll({ alive }) {
  const crowd = alive.neighborSum()
  return { alive: crowd.eq(3).or(alive.and(crowd.eq(2))) }
}
```

That is Conway's Life, and it handles a million cells (see **2D Life (fast path)**). The arithmetic is done with methods (`eq`, `add`, `where`) rather than operators, so it runs in one pass over the whole grid.

## Formulas: written once, run anywhere

`actFormula` looks the same, but the engine calls it **a single time**: its fields are placeholders, so what it returns describes the rule as a small program. The engine then runs that program for every cell, on the **graphics card** if the browser has WebGPU and on the processor if not, with the same cells either way.

```js
export default {
  initFormula: (fields, p, k) => ({ alive: k.hash('start').lt(p.density) }),
  actFormula: ({ alive }) => {
    const crowd = alive.neighborSum()
    return { alive: crowd.eq(3).or(alive.and(crowd.eq(2))) }
  },
}
```

`k.hash('start')` is a random number for each cell that is the same on every run and machine. A formula uses `where` instead of `if`, and `map` and `zip` (which take a JavaScript function) are not available; a mistake like `alive + 1` is reported in words.

Open [**Giant Life (GPU)**](../sim/#life-giant): 4096 × 4096 cells, every one kept and updated on the card. Scroll to zoom into a patch of the grid, and drag to move around. Without WebGPU the grid is too big to run, and the page says so; [**2D Life (formulas)**](../sim/#life2d-formula) is the same rule at a size any machine can run.

## Headless

The same scenes run without a browser: `node --import tsx scripts/run.mjs boids 300` prints a simulation's metrics, which is how the tests run every example.

Next: [share it and keep going](#/06-share-and-keep-going).
