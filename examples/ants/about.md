[Ant colony foraging](https://en.wikipedia.org/wiki/Ant_colony_optimization_algorithms): ants wander looking for food, and leave a scent trail on the ground when they carry some home (they turn gold while carrying). Others follow stronger scent, which makes it stronger still, so trails to food form without anyone planning them. The scent slowly fades, so trails to used-up food disappear.

The ants are drawn as flat pictures lying on the ground and turned the way they walk (a *sprite*, see `ant.svg`; a sprite can also be a billboard that always faces the camera). The nest (blue) and the food (gold, shrinking as it is eaten) are entities too: the scene's `data` says where they are. The ground is a grid of cells that holds the scent.

### What to try
- **scent laid per step** and **scent kept per step** set how strong and how lasting trails are.
- **how much scent spreads** blurs trails into wider paths.
- **how hard they steer** vs **how much they wander**: follow the trail, or explore?
- Edit `data.food` in the scene to move a food patch or change how much it holds.
