/**
 * A search strategy proposes points in the unit cube [0, 1]^d (one number per searched param) and learns from
 * how they scored. It knows nothing about simulations, params or metrics: the runner decodes points into
 * params, runs them, and reports scores (higher is better). Any search method fits: add one by implementing this.
 */
export interface Strategy {
  readonly name: string
  /** Up to `n` points to try next; fewer (or none) when the strategy has nothing more to propose right now. */
  ask(n: number): number[][]
  /** Report how the points just asked for scored, in the same order. */
  tell(points: number[][], scores: number[]): void
  /** True when there is nothing left to try. */
  done(): boolean
}
