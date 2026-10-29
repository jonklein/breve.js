The **hypercycle**, a ring of five chemicals each catalyzing the replication of the next, on **1024 × 1024 cells**, written as formulas so the graphics card runs it. The same chemistry as *Hypercycle*, about sixty times as many cells, with the picture drawn on the card too.

The sheet starts empty except for a random mixture in its middle quarter; the reaction spreads out from there and the five concentrations chase each other in spiral waves. The rule is written once (`actFormula`) and the scene's `substeps: "$speed"` runs that step several times a tick. **Scroll to zoom, drag to move.**

Without WebGPU it still runs, on the processor, but at this size it is slow there.
