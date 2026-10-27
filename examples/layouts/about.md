Nothing moves here on purpose: it shows how the same network can be **drawn** in different ways. Each dot is a node, each line a link; the color shows how many links a node has (cool is few, warm is many).

### What to try
- **Layout** changes where nodes are placed. *force* pulls linked nodes together and pushes the rest apart, so clusters show (a [force-directed layout](https://en.wikipedia.org/wiki/Force-directed_graph_drawing)). *radial* puts the best-linked node in the middle with a ring for each link of distance. The others are plain arrangements.
- **Links** changes which nodes are linked: a [small-world](https://en.wikipedia.org/wiki/Small-world_network) graph, a [scale-free](https://en.wikipedia.org/wiki/Scale-free_network) one with a few big hubs, a random graph, or a ring.

The layout is only for drawing: simulations never read positions.
