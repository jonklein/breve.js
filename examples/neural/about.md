Every walker has a small [neural network](https://en.wikipedia.org/wiki/Artificial_neural_network) for a brain. It sees where the glowing **goal** is, where its nearest neighbor is, and its own memory, and decides how to steer. Nobody tells a brain what the goal is for: at first they are random wanderers.

Each tile is one brain shared by a team of walkers. After every generation a parent program scores each tile by how close its walkers stayed to the goal, keeps the best brains and breeds the rest with a little mutation (a [genetic algorithm](https://en.wikipedia.org/wiki/Neuroevolution)). Watch the status line: the average score climbs as crowds learn to chase the goal each time it jumps. Click a tile to watch one team alone.

### What to try
- **mutation strength** is how much children differ; **best brains kept** sets how strong the selection is.
- **ticks before the goal jumps** makes the task harder (short) or easier (long).
- **brains per generation** and **walkers sharing each brain** trade search width against noise in the score.
- **how far they see** and **how hard the brain can steer** change what the brains have to work with; **Reset** starts from new random brains.
