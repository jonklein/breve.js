3D Life (the B5/S45 rule, 26 neighbors) written as **formulas**, so the whole cube is stepped on the graphics card, one cell per thread. With a card you can raise the grid to 64 or 96 cells a side; without one it runs the same rule on the processor.

Each rule is an expression handed to the engine once: `alive.neighborSum()` counts the 26 neighbors, `crowd.eq(5)` tests it, and `displayFormula` says which cells to draw and their color (young red, old green). Only the cells drawn cost anything on screen.

### What to try
- Open the editor and change `crowd.eq(5)` (born with 5) or the survival test, then watch the shapes change. Some rules die out at once, some fill the cube.
- Drag to orbit; raise `size` in `scene.json` to see how far the card goes.
- Compare with *3D Life* (the plain function version) on a 20-cell cube.
