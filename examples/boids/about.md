[Boids](https://en.wikipedia.org/wiki/Boids) (Craig Reynolds, 1986) are birds that flock without a leader. Each one follows three simple rules about its nearby neighbors:

- **cohesion**: steer toward the middle of the group
- **alignment**: match the neighbors' heading
- **separation**: do not crowd anyone

Flocks, swirls and splits appear from those rules alone.

### What to try
- The **cohesion**, **alignment** and **separation** sliders weight each rule. Turn one to 0 to see what it was doing.
- **neighbor radius** is how far a boid sees; **separation radius** is how close is too close.
- **random jitter** keeps the flock from settling into one ball; **min/max speed** set how fast they fly.
- Drag to turn the view, scroll to zoom.
