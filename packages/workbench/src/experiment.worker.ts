import { parseScene } from '@breve/core'
import { parseExperiment, plannedRuns, runExperiment, type ExperimentResult, type ExperimentSpec, type Trial } from '@breve/experiment'
import { compile } from './script-load'
import type { FromEval, ToEval } from './eval.worker'

export type ToExperiment =
  | { type: 'run'; scene: string; script: string; experiment: string }
  | { type: 'stop' }

export type FromExperiment =
  | { type: 'started'; total: number; workers: number }
  | { type: 'trial'; trial: Trial; done: number }
  | { type: 'done'; result: ExperimentResult; stopped: boolean }
  | { type: 'error'; errors: string[] }

let stop = false

/**
 * Workers that run candidates side by side. Each holds its own copy of the scene and script. A candidate that is asked for while
 * every worker is busy waits its turn.
 */
class Pool {
  private idle: Worker[] = []
  private waiting: ((w: Worker) => void)[] = []
  private all: Worker[] = []

  static async start(n: number, scene: string, script: string): Promise<Pool> {
    const pool = new Pool()
    await Promise.all(Array.from({ length: n }, () => new Promise<void>((resolve, reject) => {
      const w = new Worker(new URL('./eval.worker.ts', import.meta.url), { type: 'module' })
      w.onerror = (e) => reject(new Error(e.message || 'an evaluation worker failed to start'))
      w.onmessage = (ev: MessageEvent<FromEval>) => {
        if (ev.data.type === 'ready') { pool.all.push(w); pool.idle.push(w); resolve() } else if (ev.data.type === 'error') reject(new Error(ev.data.message))
      }
      w.postMessage({ type: 'setup', scene, script } satisfies ToEval)
    })))
    return pool
  }

  get size(): number { return this.all.length }

  private take(): Promise<Worker> {
    const w = this.idle.pop()
    return w ? Promise.resolve(w) : new Promise((resolve) => this.waiting.push(resolve))
  }

  async evaluate(spec: ExperimentSpec, params: Record<string, number>): Promise<Omit<Trial, 'id'>> {
    const w = await this.take()
    try {
      return await new Promise((resolve, reject) => {
        w.onerror = (e) => reject(new Error(e.message || 'an evaluation worker failed'))
        w.onmessage = (ev: MessageEvent<FromEval>) => {
          if (ev.data.type === 'result') resolve(ev.data.result)
          else if (ev.data.type === 'error') reject(new Error(ev.data.message))
        }
        w.postMessage({ type: 'eval', id: 0, spec, params } satisfies ToEval)
      })
    } finally {
      const next = this.waiting.shift()
      if (next) next(w)
      else this.idle.push(w)
    }
  }

  stop(): void {
    for (const w of this.all) w.terminate()
    this.all = []
    this.idle = []
  }
}

/** How many workers to use: one fewer than the machine has cores (the page needs one), at most 4; one means "run it here". */
const poolSize = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 2) - 1))

self.onmessage = async (ev: MessageEvent<ToExperiment>) => {
  const m = ev.data
  if (m.type === 'stop') { stop = true; return }
  stop = false
  const post = (msg: FromExperiment) => postMessage(msg)
  const scene = parseScene(m.scene)
  if (!scene.ok) return post({ type: 'error', errors: scene.errors.map((e) => `scene.json: ${e}`) })
  const spec = parseExperiment(m.experiment, scene.scene)
  if (!spec.ok) return post({ type: 'error', errors: spec.errors.map((e) => `experiment.json: ${e}`) })
  let script
  try { script = await compile(m.script) } catch (e) { return post({ type: 'error', errors: [`script: ${e instanceof Error ? e.message : String(e)}`] }) }
  try {
    // several workers when there are cores to spare; if they cannot start (an environment without nested workers), run here
    let pool: Pool | null = null
    if (poolSize() > 1) { try { pool = await Pool.start(poolSize(), m.scene, m.script) } catch { pool = null } }
    try {
      post({ type: 'started', total: plannedRuns(spec.spec, scene.scene), workers: pool?.size ?? 1 })
      const result = await runExperiment(spec.spec, { scene: scene.scene, script }, {
        evaluate: pool ? (params) => pool!.evaluate(spec.spec, params) : undefined,
        onTrial: (trial, done) => post({ type: 'trial', trial, done }),
        shouldStop: () => stop,
      })
      post({ type: 'done', result, stopped: stop })
    } finally {
      pool?.stop()
    }
  } catch (e) {
    post({ type: 'error', errors: [e instanceof Error ? e.message : String(e)] })
  }
}
