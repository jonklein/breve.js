---
title: Other kinds of worlds
summary: Free agents, grids of cells, networks, and bodies with physics: the same script ideas on each.
---

The scene says what kind of thing each *entity set* is. The script hooks stay the same.

## Free agents

What you have used so far: things with a position and a velocity that move in space (flocks, ants, herds, markets of wandering traders). `count` says how many.

## Grids of cells

Add a `lattice` to an entity set and every cell is an entity that sees its neighbors. **2D Life** is a grid; **Gray-Scott** grows patterns on one. A cell's `act` returns its new state, for example `{ alive: 1 }`. Edges can wrap around.

## Networks

A `network` is nodes joined by links, and a node sees the nodes it is linked to. **Epidemic** spreads a disease along links; the *same script* also runs it on a grid of cells, because it only asks "who are my neighbors, and how many are infected?".

## Bodies with physics

Give an entity a `body` (boxes, spheres, hinge joints with motors) and it becomes a creature in a physics world with terrain. **Creature** is a jointed body walking on terrain; **Evolved creatures** runs a whole population side by side and breeds the best walkers. The physics engine is chosen in the scene (`"physics": { "engine": "mujoco" }`), and a script can run a *population* of simulations, each with its own camera tile, from a parent script.

## Several at once

A scene can hold several sets at once: ants, food, a nest, and the ground they leave scent on are four sets in **Ants**, each with its own small script.

Where to look next: the **Gallery** shows every example with a picture; each one has an **About** card, and opening it puts all of its code in your editor. Next: [making it fast](#/05-making-it-fast).
