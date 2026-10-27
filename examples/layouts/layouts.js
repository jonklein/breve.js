// Nothing happens here on purpose: it is a way to look at the same network drawn different ways.
// Press the buttons in the panel to change how the nodes are placed (and what the links are).
// Color shows how many links a node has: well-linked ones glow warm, loosely linked ones stay cool.
export default {
  initAll({ count }) {
    return { links: new Float32Array(count) }
  },

  displayAll({ links }, p, ctx) {
    return { color: ctx.colors.rampField(['#5b8cff', '#7bd88f', '#ffd24d', '#ff6b6b'], links.div(12).clamp(0, 1)) }
  },

  act({ neighbors }) {
    return { links: neighbors.links.length }
  },
}
