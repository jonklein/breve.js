import { Sim, SimGroup, parseScene, withParams, type RigidFrame, type Scene, type ScriptModule } from '@breve/core'

export type ToWorker =
  | { type: 'init'; scene: string; script: string }
  | { type: 'scene'; scene: string }
  | { type: 'script'; script: string }
  | { type: 'play'; running: boolean }
  | { type: 'step' }
  | { type: 'reset' }
  /** Run the scene once per value of one param, side by side. */
  | { type: 'sweep'; param: string; values: number[] }
  /** Leave the sweep. */
  | { type: 'single' }
  /** Continue from one sweep tile as the single sim. */
  | { type: 'focus'; name: string }

/** One frame of one world. */
export interface WorldFrameMsg {
  kind: 'agents' | 'lattice' | 'bodies'
  count: number
  size: number
  unit: number
  pos: Float32Array
  vel: Float32Array | null
  attr: Float32Array | null
  lattice?: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number }
  rigid?: RigidFrame
}

export type FromWorker =
  | { type: 'tiles'; tick: number; rate: number; stepMs: number; tiles: (WorldFrameMsg & { name: string; value: number; metrics: Record<string, number> | null })[] }
  | { type: 'focused'; param: string; value: number }
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
// sweep mode: many sims in one group, ticking together
let group: SimGroup | null = null
let sweepParam = ''

async function compile(code: string): Promise<ScriptModule> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    const mod = (await import(/* @vite-ignore */ url)) as ScriptModule
    if (!mod.default || (typeof mod.default.decide !== 'function' && typeof mod.default.update !== 'function'))
      throw new Error('the script must `export default { decide(obs, params, ctx) { ... } }` (or `update`, for lattices)')
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
    if (group) for (const [name, s] of group.sims) s.setScene(withParams(r.scene, { [sweepParam]: Number(name.split('=')[1]) }))
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

function transfers(f: WorldFrameMsg): ArrayBuffer[] {
  return [f.pos.buffer as ArrayBuffer, ...(f.vel ? [f.vel.buffer as ArrayBuffer] : []), ...(f.attr ? [f.attr.buffer as ArrayBuffer] : []), ...(f.lattice ? [f.lattice.show.buffer as ArrayBuffer] : []), ...(f.rigid ? [f.rigid.poses.buffer as ArrayBuffer] : [])]
}

let groupTick = -1

function postGroup(): void {
  if (!group) return
  const first = group.sims.values().next().value as Sim | undefined
  if (first && first.tick !== groupTick) {
    groupTick = first.tick
    const all = first.tick % 4 === 0 || first.rate < 30
    const tiles = [...group.sims].map(([name, s]) => ({ name, value: Number(name.split('=')[1]), metrics: all ? s.metrics() : null, ...s.frame() }))
    postMessage({ type: 'tiles', tick: first.tick, rate: first.rate, stepMs, tiles } satisfies FromWorker, tiles.flatMap(transfers))
  }
  const runtime = [...new Set([...group.sims.values()].flatMap((s) => s.takeErrors()))]
  const problems = JSON.stringify([sceneErrors, scriptErrors, runtime])
  if (problems !== lastSent || runtime.length) {
    lastSent = problems
    postMessage({ type: 'problems', scene: sceneErrors, script: scriptErrors, runtime } satisfies FromWorker)
  }
}

function post(): void {
  if (group) return postGroup()
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
const FRAME_BUDGET_MS = 12 // never spend more than this per frame stepping, so the page stays responsive
setInterval(() => {
  const driver = group ? group.sims.values().next().value as Sim | undefined : sim
  if (running && driver) {
    budget = Math.min(budget + driver.rate / 60, 8)
    const frameStart = performance.now()
    while (budget >= 1) {
      const t0 = performance.now()
      if (group) group.step()
      else sim!.step()
      stepMs = stepMs * 0.8 + (performance.now() - t0) * 0.2
      budget--
      if (performance.now() - frameStart > FRAME_BUDGET_MS) { budget = Math.min(budget, 1); break }
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
      group?.dispose()
      group = null
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
      if (script) { sim?.setScript(script); if (group) for (const s of group.sims.values()) s.setScript(script) }
      break
    case 'play':
      running = m.running
      break
    case 'step':
      if (group) group.step()
      else sim?.step()
      break
    case 'sweep':
      if (!scene) break
      try {
        group?.dispose()
        group = null
        const g = await SimGroup.sweep(scene, script ?? undefined, m.param, m.values)
        group = g
        sweepParam = m.param
        groupTick = -1
        lastSent = ''
      } catch (e) {
        sceneErrors = [e instanceof Error ? e.message : String(e)]
      }
      break
    case 'single':
      group?.dispose()
      group = null
      lastPosted = -1
      break
    case 'focus': {
      if (!group || !group.sims.has(m.name)) break
      const value = Number(m.name.split('=')[1])
      const param = sweepParam
      let copy: Sim
      try {
        copy = group.get(m.name).fork()
      } catch {
        // physics scenes cannot be forked yet: start a fresh run with that param value instead
        copy = await Sim.create(withParams(scene!, { [param]: value }), script ?? undefined)
      }
      group?.dispose()
      group = null
      sim?.dispose()
      sim = copy
      lastPosted = -1
      postMessage({ type: 'focused', param, value } satisfies FromWorker)
      break
    }
    case 'reset':
      applyScene(sceneText)
      if (group && scene) {
        const names = [...group.sims.keys()]
        group.dispose()
        group = await SimGroup.sweep(scene, script ?? undefined, sweepParam, names.map((n) => Number(n.split('=')[1])))
        groupTick = -1
      } else await rebuild()
      break
  }
}
