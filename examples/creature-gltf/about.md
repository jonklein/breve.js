The walking creature with a modeled body: its torso is a [glTF model](https://en.wikipedia.org/wiki/GlTF) (`beetle.glb`), and the model is also the physics shape. The collider is the model's *convex hull* (its outline with dents filled in), so what you see is what hits the ground. Legs are the same capsules as in the *Creatures* example, driven by the same gait sliders.

To use your own model, set the torso to `"shape": "mesh"` and point `visual.gltf` at a `.glb` file; `scale`, `rotation` and `offset` place it. A hull cannot be hollow, so split a hollow object into several parts.
