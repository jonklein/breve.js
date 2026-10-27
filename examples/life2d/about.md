[Conway's Game of Life](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life) on a flat grid: a live cell with two or three live neighbors survives, and a dead cell with exactly three is born.

This version updates the whole grid at once with field operations instead of running a rule per cell, which is why it stays fast on a big grid. Look at the script to see how short the rule becomes.
