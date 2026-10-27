Every agent has its own small [neural network](https://en.wikipedia.org/wiki/Artificial_neural_network) as a brain: it looks at its neighbors and decides how to steer. The weights are different for each agent and live in its state; there is no learning here, so this shows what random brains do and how the pieces fit together.

### What to try
- **how far they see** sets the neighbors a brain gets as input.
- **how hard the brain can steer** scales its output; **maxSpeed** limits speed.
- Open the script to see how a brain is built with `ctx.mlp`. The *Evolved creatures* example improves brains like these by breeding.
