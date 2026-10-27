Four-legged walkers on bumpy terrain, with real [rigid-body physics](https://en.wikipedia.org/wiki/Rigid_body_dynamics). Each body is a few boxes joined by motors, described as JSON in the scene; the script swings the legs with a simple oscillator (a gait) and steers.

### What to try
- **step rate**, **stride** and **foot lift** shape the gait; the **phase** sliders set which legs move together (diagonal pairs is a trot).
- **muscle strength** is how hard the joint motors push: too low and they sag.
- **steering** and **wander** control where they go; **stay within** keeps them in the arena.
- Physics takes a moment to load the first time.
