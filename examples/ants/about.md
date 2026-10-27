[Ant colony foraging](https://en.wikipedia.org/wiki/Ant_colony_optimization_algorithms): ants wander looking for food, and leave a scent trail on the ground when they carry some home. Others follow stronger scent, which makes it stronger still, so trails to food form without anyone planning them. The scent slowly fades, so trails to used-up food disappear.

The ground is a second set of entities (a grid of cells) in the same world as the ants.

### What to try
- **scent laid per step** and **scent kept per step** set how strong and how lasting trails are.
- **how much scent spreads** blurs trails into wider paths.
- **how hard they steer** vs **how much they wander**: follow the trail, or explore?
