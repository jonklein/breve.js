import { parseScene } from '@breve/core'
import { parseExperiment, plannedRuns, runExperiment, type ExperimentResult, type Trial } from '@breve/experiment'
import { compile } from './script-load'

export type ToExperiment =
  | { type: 'run'; scene: string; script: string; experiment: string }
  | { type: 'stop' }

export type FromExperiment =
  | { type: 'started'; total: number }
  | { type: 'trial'; trial: Trial; done: number }
  | { type: 'done'; result: ExperimentResult; stopped: boolean }
  | { type: 'error'; errors: string[] }

let stop = false

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
    post({ type: 'started', total: plannedRuns(spec.spec, scene.scene) })
    const result = await runExperiment(spec.spec, { scene: scene.scene, script }, {
      onTrial: (trial, done) => post({ type: 'trial', trial, done }),
      shouldStop: () => stop,
    })
    post({ type: 'done', result, stopped: stop })
  } catch (e) {
    post({ type: 'error', errors: [e instanceof Error ? e.message : String(e)] })
  }
}
