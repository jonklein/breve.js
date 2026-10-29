The Gray-Scott reaction-diffusion model on **1024 × 1024 cells**, written as formulas so the graphics card can run it: the same spots, stripes, mazes and coral as *Reaction-diffusion*, about a thousand times as many cells, with the picture drawn on the card as well. The sheet starts empty except for a few blobs of v in its middle quarter, and the pattern grows outward from there. **Red** is v, **blue** is u, and where both are present they add up to purple, on a dark ground.

The rule is written once (`actFormula`), and the scene asks for `substeps: "$speed"`, so the engine runs that small step several times every tick. Press a **Pattern** button to jump to a known setting, then nudge *supply* and *decay* (tiny changes flip spots into stripes). **Scroll to zoom, drag to move.**

Without WebGPU it still runs, on the processor, but 1024 × 1024 is slow there. *Reaction-diffusion* is the same chemistry at a size every machine handles.
