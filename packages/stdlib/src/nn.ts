/**
 * A small fully connected network with tanh layers, for controllers that keep their weights in a state array.
 * The shape is fixed by `sizes`; the weights live in the agent's state (so they are snapshotted, forked and
 * mutated like any other column). Layout per layer: `out × in` weights, then `out` biases.
 */
export class Mlp {
  readonly weightCount: number

  constructor(readonly sizes: readonly number[]) {
    if (sizes.length < 2 || sizes.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('mlp([in, ..., out]) needs at least two whole-number layer sizes')
    let n = 0
    for (let l = 1; l < sizes.length; l++) n += sizes[l] * sizes[l - 1] + sizes[l]
    this.weightCount = n
  }

  run(weights: ArrayLike<number>, inputs: ArrayLike<number>): number[] {
    if (weights.length !== this.weightCount) throw new Error(`this network needs ${this.weightCount} weights, got ${weights.length}`)
    if (inputs.length !== this.sizes[0]) throw new Error(`this network takes ${this.sizes[0]} inputs, got ${inputs.length}`)
    let x: ArrayLike<number> = inputs
    let w = 0
    for (let l = 1; l < this.sizes.length; l++) {
      const nIn = this.sizes[l - 1], nOut = this.sizes[l]
      const y = new Array<number>(nOut)
      for (let o = 0; o < nOut; o++) {
        let s = 0
        for (let i = 0; i < nIn; i++) s += weights[w + o * nIn + i] * x[i]
        y[o] = Math.tanh(s + weights[w + nOut * nIn + o])
      }
      w += nOut * nIn + nOut
      x = y
    }
    return Array.from(x)
  }
}
