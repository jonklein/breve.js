Braitenberg's vehicles: little carts with two light sensors and two motors, and nothing else. **How the sensors are wired to the motors** is the whole difference between a cart that swerves away from a light, one that swerves toward it, one that slows as it nears and settles in front of it, and one that heads for a light and then swerves off.

The carts here are real physics: a chassis on two driven wheels and a caster, bumping into each other on a floor with friction. There are four wirings, handed out in turn: *fear*, *aggression*, *love* and *explorer*. The yellow poles are the lights.

### What to try
- Watch the four charts: each is how far that kind of cart is from its nearest light.
- Open the editor and find `data.kinds`: each wiring is a 2×2 table (`weights`) of how much each eye pushes each wheel, and a resting drive (`bias`). Change a sign and the cart's character changes. Try `[[1, 1], [1, 1]]`, or make up your own.
- Move a light by editing `data.lights` **and** the matching entry in `world.markers` (one is what the carts sense, the other is what you see).
- *top speed*, *how far the eyes see* and *how far apart the eyes look* are sliders.
