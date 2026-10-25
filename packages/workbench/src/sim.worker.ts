import { Sim, parseScene, type RigidFrame, type Scene, type ScriptModule } from '@breve/core'

export type ToWorker =
  | { type: 'init'; scene: string; script: string }
  | { type: 'scene'; scene: string }
  | { type: 'script'; script: string }
  | { type: 'play'; running: boolean }
  | { type: 'step' }
  | { type: 'reset' }

export type FromWorker =
  | { type: 'frame'; tick: number; kind: 'agents' | 'lattice' | 'bodies'; count: number; size: number; unit: number; pos: Float32Array; vel: Float32Array | null; attr: Float32Array | null; lattice?: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number }; rigid?: RigidFrame; rate: number; metrics: Record<string, number> | null; stepMs: number }
  | { type: 'problems'; scene: string[]; script: string[]; runtime: string[] }

let sim: Sim | null = null
let scene: Scene | null = null
let sceneText = ''
let script: ScriptModule | null = null
let running = true
let sceneErrors: string[] = []
let scriptErrors: string[] = []
let lastSent = ''

async function compile(code: string): Promise<ScriptModule> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    const mod = (await import(/* @vite-ignore */ url)) as ScriptModule
    if (!mod.default || typeof mod.default.decide !== 'function')
      throw new Error('the script must `export default { decide(obs, params, ctx) { ... } }`')
    return mod
  } finally {
    URL.revokeObjectURL(url)
  }
}

function applyScene(text: string): void {
  sceneText = text
  const r = parseScene(text)
  if (r.ok) {
    scene = r.scene
    sceneErrors = []
    sim?.setScene(r.scene)
  } else {
    sceneErrors = r.errors
  }
}

async function applyScript(code: string): Promise<void> {
  try {
    script = await compile(code)
    scriptErrors = []
  } catch (e) {
    scriptErrors = [e instanceof Error ? e.message : String(e)]
  }
}

// async because scenes with a physics body wait for the physics engine to load
let builds = 0
async function rebuild(): Promise<void> {
  if (!scene) return
  const mine = ++builds
  const next = await Sim.create(scene, script ?? undefined)
  if (mine !== builds) return next.dispose() // a newer rebuild started while this one loaded
  sim?.dispose()
  sim = next
}

let lastPosted = -1
let stepMs = 0 // smoothed time one tick takes, shown in the stats line

function post(): void {
  if (!sim) return
  if (sim.tick !== lastPosted) {
    lastPosted = sim.tick
    const f = sim.frame()
    const m = sim.tick % 4 === 0 || sim.rate < 30 ? sim.metrics() : null
    const msg: FromWorker = { type: 'frame', tick: sim.tick, metrics: m, stepMs, rate: sim.rate, ...f }
    const transfer = [f.pos.buffer, ...(f.vel ? [f.vel.buffer] : []), ...(f.attr ? [f.attr.buffer] : []), ...(f.lattice ? [f.lattice.show.buffer] : []), ...(f.rigid ? [f.rigid.poses.buffer] : [])]
    postMessage(msg, transfer)
  }
  const runtime = sim.takeErrors()
  const problems = JSON.stringify([sceneErrors, scriptErrors, runtime])
  if (problems !== lastSent || runtime.length) {
    lastSent = problems
    postMessage({ type: 'problems', scene: sceneErrors, script: scriptErrors, runtime } satisfies FromWorker)
  }
}

// The clock runs at the scene's tick rate; the page is told about every new tick.
let budget = 0
setInterval(() => {
  if (running && sim) {
    budget = Math.min(budget + sim.rate / 60, 8)
    while (budget >= 1) {
      const t0 = performance.now()
      sim.step()
      stepMs = stepMs * 0.8 + (performance.now() - t0) * 0.2
      budget--
    }
  }
  post()
}, 1000 / 60)

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data
  switch (m.type) {
    case 'init':
      sim?.dispose()
      sim = null
      script = null
      scene = null
      lastPosted = -1
      applyScene(m.scene)
      await applyScript(m.script)
      await rebuild()
      break
    case 'scene':
      applyScene(m.scene)
      break
    case 'script':
      await applyScript(m.script)
      if (script) sim?.setScript(script)
      break
    case 'play':
      running = m.running
      break
    case 'step':
      sim?.step()
      break
    case 'reset':
      applyScene(sceneText)
      await rebuild()
      break
  }
}
