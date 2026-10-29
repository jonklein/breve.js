Fish that swim by bending, in water the physics engine knows nothing about. The engine can push things, so the script works out what water would do to each part of a fish and pushes: **buoyancy** while a part is under the surface, and **drag**, much stronger across a flat part than along it. That is a few lines of the standard library's `Fluid`.

Nothing pushes a fish forward. It bends in a wave from head to tail; each segment pushes water back as it swings, and the water pushes it on. A broad tail pushes more. There are three kinds: quick **minnows**, **tuna** with big tails, and long **eels**. A fish rises and dives by tilting its nose up or down (a couple of torque, like fins) so its own thrust carries it that way.

### What to try
- **drag** at 0: the fish waggle in place.
- **buoyancy** under 1: they sink toward the floor.
- Change the **body wave**, **tail beat** and **body swing**, or add a **current**.
- **how much they rise and dive** at 0: they hold their depth.
- The water's height is `data.water.level`; the surface is drawn from the same entry.
