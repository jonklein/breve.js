// A little market on a network of traders.
//
// Everyone holds cash and goods, and names an asking price for the goods they sell.
//   - One in three traders is a producer and makes a new good every few ticks.
//   - Everyone uses up a good every few ticks. With none left, they are in need.
//   - A trader in need looks at the neighbors who have goods, and buys from the cheapest one
//     whose price they can afford and think is fair (below `worth`).
//   - Everyone but producers earns wages each tick; producers pay running costs.
//   - A producer who is running low raises the price; one sitting on a pile lowers it. Everyone else
//     asks about what their neighbors ask.
//
// A trade is an `exchange`: both sides change together or not at all, so a trade never makes or loses
// cash (wages and running costs do). Watch the prices settle, and try making goods scarce (raise produceEvery).

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export default {
  // everyone starts with some cash, two goods and an asking price
  init() {
    return { cash: 60, goods: 2, ask: 10, bought: 0, used: 0 }
  },

  // color by asking price: cheap blue, middling yellow, dear red
  display({ self }, p, ctx) {
    return { color: ctx.colors.gradient(['#4da3ff', '#ffd24d', '#ff5a4d'], self.ask / 40) }
  },

  act({ self, neighbors }, p, ctx) {
    const producer = self.row % 3 === 0
    const makes = producer && ctx.tick % p.produceEvery === 0 ? 1 : 0
    const uses = ctx.tick % p.consumeEvery === 0 && self.goods > 0 ? 1 : 0

    // adjust my price: producers react to their stock, everyone else just follows what the neighbors charge
    let ask = self.ask
    if (producer) {
      if (self.goods <= 1) ask = clamp(ask * 1.05, 1, 100) // running low: charge more
      else if (self.goods >= 3) ask = clamp(ask * 0.97, p.costs, 100) // piling up: charge less
    } else if (!neighbors.isEmpty()) {
      ask = ask + (neighbors.ask.average() - ask) * 0.1
    }

    // money comes in as wages for everyone but producers, who pay running costs
    const cash = Math.max(0, self.cash + (producer ? -p.costs : p.wages))
    const result = { goods: self.goods + makes - uses, used: self.used + uses, ask, cash }

    // in need: buy one from the cheapest affordable neighbor
    if (self.goods + makes - uses < 1) {
      const sellers = neighbors.filter((n) => n.goods > 0 && n.ask <= cash && n.ask <= p.worth)
      if (sellers.length) {
        const best = sellers.reduce((a, b) => (b.ask < a.ask ? b : a))
        result.exchange = [{ with: best, give: { cash: best.ask }, get: { goods: 1 } }]
        result.bought = self.bought + 1
      }
    }
    return result
  },
}

export const metrics = {
  averagePrice: ({ sets }) => sets.traders.ask.average(),
  priceSpread: ({ sets }) => {
    const asks = sets.traders.ask
    const mean = asks.average()
    return Math.sqrt(asks.map((a) => (a - mean) ** 2).reduce((s, v) => s + v, 0) / Math.max(1, asks.length))
  },
  averageCash: ({ sets }) => sets.traders.cash.average(),
  unmetNeed: ({ sets }) => sets.traders.goods.filter((g) => g < 1).length,
}
