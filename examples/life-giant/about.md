Conway's Life on **4096 × 4096 cells** (16.8 million), with every cell kept and updated on the graphics card.

The rule is three formulas (`initFormula`, `actFormula`, `displayFormula`) that the engine reads once and compiles to a shader. A generation is a single pass over all the cells at the same time; the picture is drawn there as well, only for the part of the grid on screen, so a grid this big costs no more to show than a small one. **Scroll to zoom, drag to move.** The population count is a total the card works out too.

It needs a browser with WebGPU. Without one the grid is too large for the processor, and the scene reports that instead of trying. The smaller *2D Life (formulas)* runs either way.
