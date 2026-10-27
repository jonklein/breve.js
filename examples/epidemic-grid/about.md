The same [SIR epidemic](https://en.wikipedia.org/wiki/Compartmental_models_in_epidemiology) script as the network example, run on a grid: it only asks each cell who its neighbors are, so it does not care whether they are on a grid or a graph. Blue are susceptible, red infected, green recovered.

### What to try
- **chance per sick neighbor** and **ticks until recovered** set how contagious it is and for how long.
- Compare with *Epidemic on a network*: on a grid the infection moves as a spreading ring, while the shortcuts in a small-world network let it jump.
