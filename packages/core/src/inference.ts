/**
 * A trained model that maps rows of numbers to rows of numbers: a policy network, a classifier, an encoder. The core only
 * knows this shape; an inference backend (the `@breve/inference` package wraps ONNX Runtime) supplies the real thing, and
 * the host registers it on the sim (`sim.models.policy = model`). Keeping the runtime out of core keeps the core headless and small.
 */
export interface Model {
  /** Numbers per input row, when the model says (used to check a batch before running it). */
  readonly inputWidth?: number
  /** Numbers per output row, when the model says. */
  readonly outputWidth?: number
  /** False when the same input may give a different output (GPU math, say). Such a model makes its sets non-repeatable. */
  readonly deterministic: boolean
  /** Run `rows` input rows (laid out one after another in `input`) and return the output rows the same way. */
  run(input: Float32Array, rows: number): Promise<Float32Array>
}

/** What a script gets from `ctx.model(name)`: plain arrays in and out, and a batch form for a whole population at once. */
export interface ModelHandle {
  readonly inputWidth?: number
  readonly outputWidth?: number
  /** One observation in, one output row out. */
  run(input: ArrayLike<number>): Promise<number[]>
  /** Many observations in one call (one array per agent, or one flat array), one output row per observation. Much faster than a call each. */
  runBatch(inputs: ArrayLike<number>[] | Float32Array): Promise<number[][]>
}

export function handleFor(name: string, model: Model): ModelHandle {
  const width = (n: number) => {
    if (model.inputWidth !== undefined && n !== model.inputWidth) throw new Error(`model "${name}" takes ${model.inputWidth} numbers per observation, got ${n}`)
  }
  const rowsOf = (flat: Float32Array, n: number): number[][] => {
    const w = n ? flat.length / n : 0
    return Array.from({ length: n }, (_, i) => Array.from(flat.subarray(i * w, (i + 1) * w)))
  }
  return {
    inputWidth: model.inputWidth,
    outputWidth: model.outputWidth,
    async run(input) {
      width(input.length)
      return rowsOf(await model.run(Float32Array.from(input as ArrayLike<number>), 1), 1)[0]
    },
    async runBatch(inputs) {
      if (inputs instanceof Float32Array) {
        const w = model.inputWidth
        if (!w) throw new Error(`model "${name}" does not say how wide an observation is, so pass one array per observation`)
        if (inputs.length % w) throw new Error(`model "${name}" takes ${w} numbers per observation, but got ${inputs.length} numbers in all`)
        return rowsOf(await model.run(inputs, inputs.length / w), inputs.length / w)
      }
      if (!inputs.length) return []
      const w = inputs[0].length
      width(w)
      const flat = new Float32Array(inputs.length * w)
      inputs.forEach((row, i) => {
        if (row.length !== w) throw new Error(`model "${name}": every observation must have the same width (${w}), observation ${i} has ${row.length}`)
        for (let k = 0; k < w; k++) flat[i * w + k] = row[k]
      })
      return rowsOf(await model.run(flat, inputs.length), inputs.length)
    },
  }
}
