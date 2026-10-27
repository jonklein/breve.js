Braitenberg's vehicles: little carts with two light sensors and two motors, and nothing else. **How the sensors are wired to the motors** is the whole difference between a cart that swerves away from a light, one that swerves toward it, one that slows as it nears and settles in front of it, and one that heads for a light and then swerves off.

The carts here are real physics: a chassis on four wheels (the two on each side driven together, so it turns by skidding), bumping into each other on a floor with friction. Four wirings are handed out in turn: *fear*, *aggression*, *love* and *explorer*. The yellow poles are the lights.

### What to try
- Watch the four charts: each is how far that kind of cart is from its nearest light.
- Open the editor and find `data.kinds`: each wiring is a 2×2 table (`weights`) of how much each eye pushes each side's wheels, and a resting drive (`bias`). Change a sign and the character changes.
- Move a light by editing its `at` in `data.lights`: the carts sense that list and `world.markers` draws it, so both follow.
