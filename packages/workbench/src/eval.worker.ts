import { parseScene, type Scene, type ScriptModule } from '@breve/core'
import { evaluate, type ExperimentSpec, type Trial } from '@breve/experiment'
import { compile } from './script-load'

/** One of the workers an experiment spreads its candidates over: it holds the scene and script, and runs candidates it is given. */
export type ToEval =
  | { type: 'setup'; scene: string; script: string }
  | { type: 'eval'; id: number; spec: ExperimentSpec; params: Record<string, number> }

export type FromEval =
  | { type: 'ready' }
  | { type: 'result'; id: number; result: Omit<Trial, 'id'> }
  | { type: 'error'; id?: number; message: string }

let base: { scene: Scene; script: ScriptModule } | null = null

self.onmessage = async (ev: MessageEvent<ToEval>) => {
  const m = ev.data
  const post = (msg: FromEval) => postMessage(msg)
  if (m.type === 'setup') {
    try {
      const scene = parseScene(m.scene)
      if (!scene.ok) return post({ type: 'error', message: scene.errors.join('; ') })
      base = { scene: scene.scene, script: await compile(m.script) }
      post({ type: 'ready' })
    } catch (e) {
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    }
    return
  }
  try {
    if (!base) throw new Error('the worker has no scene yet')
    post({ type: 'result', id: m.id, result: await evaluate(m.spec, base, m.params) })
  } catch (e) {
    post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) })
  }
}
