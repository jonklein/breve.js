---
title: Run your first simulation
summary: Open the workbench, press play, and see what the controls do.
---

breve runs small simulations you can change while they run. Nothing to install: open the **Simulations** page and pick one from the list at the top. Start with **Hello: random walkers** ([open it](../sim/#hello)).

## What you are looking at

Sixty walkers wander around a box. Under the picture:

- **Play / Pause**, **Step** (one tick at a time) and **Reset** (start again from the same seed, so the run repeats exactly).
- A **timeline**: drag it to go back to an earlier moment, and play on from there to branch a new run.
- **Controls**: one slider for every number the simulation lets you change. Move *how much each walker wanders* and watch the walkers react at once.
- A **chart** for each number the simulation measures. Here it is *spread*: how far the walkers are from the middle, on average.

Drag in the picture to turn the camera, scroll to zoom. Click a walker to look at it: you can see (and change) its numbers.

The card in the corner (**About**) says what the simulation is. It folds away.

## Try this

1. Set *wander* to 0. Nothing pushes the walkers, so they drift in a straight line until the soft wall turns them back.
2. Set it to 20 and press **Reset** a few times. The seed is fixed, so every reset gives the same run: change the number, not the luck.
3. Pick **Boids** from the list ([open it](../sim/#boids)). Sixty-odd birds follow three rules, and a flock appears. Move *cohesion* and *separation* and see how the flock changes character.

The rest of the guide shows how these are written, so you can change them and make your own. Next: [change something](#/02-change-something).
