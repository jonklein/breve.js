Fish that swim by bending, in water the physics engine knows nothing about. The engine can push things, so the script works out what water would do to every part of a fish and pushes: **buoyancy** while a part is under the surface, and **drag**, which is much stronger across a flat part than along it. That is a few lines of the standard library's `Fluid`.

Nothing pushes a fish forward. It bends in a wave that runs from head to tail; each segment, as it swings sideways, pushes water back and the water pushes it on. Take the drag away and the same wave goes nowhere.

### What to try
- Slide **drag** to 0: the fish waggle in place. Raise it and they move more slowly but cleanly.
- Slide **buoyancy** under 1: they sink and crawl along the floor; over 1 they float up and bob at the surface.
- Change the **wave lag** and **tail beat** to find what swims fastest, or add a **current** and watch them drift.
- The water's height is `data.water.level`; the translucent surface is drawn from the same entry, so changing it moves both.
