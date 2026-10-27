Conway's Life with each rule written as a **formula**: an expression handed to the engine once, instead of a function called for every cell.

`actFormula` runs a single time. Its fields are placeholders, so what it returns describes the whole rule, and the engine runs that description for every cell on each tick. Where there is a graphics card it runs there; otherwise on the processor, with the same result. `initFormula` and `displayFormula` work the same way for the starting cells and their colors, and `k.hash('name')` gives each cell its own repeatable random number.

The cost is a smaller vocabulary: methods (`crowd.eq(3)`, `age.add(1)`, `alive.neighborSum()`) instead of operators, and `where` instead of `if`. The plain version of this rule is in *2D Life (fast path)*.
