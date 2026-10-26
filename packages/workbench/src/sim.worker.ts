import { compile } from './script-load'
import { Sim, SimGroup, type Inspected, parseScene, withParams, type RigidFrame, type Scene, type ScriptModule } from '@breve/core'

export type ToWorker =
  | { type: 'init'; scene: string; script: string }
  | { type: 'scene'; scene: string }
  | { type: 'script'; script: string }
  | { type: 'play'; running: boolean }
  | { type: 'step' }
  | { type: 'reset' }
  /** The keys held down in the view, for human-driven controllers. */
  | { type: 'keys'; keys: string[] }
  /** Watch one entity (or nothing). Its fields come back with every frame. */
  | { type: 'inspect'; set: number; row: number }
  | { type: 'uninspect' }
  /** Edit one value of one entity. */
  | { type: 'poke'; set: number; row: number; field: string; value: number | boolean | string; index?: number }
  /** Run the scene once per value of one param, side by side. */
  | { type: 'sweep'; runs: { name: string; params: Record<string, number> }[] }
  /** Leave the sweep. */
  | { type: 'single' }
  /** Continue from one sweep tile as the single sim. */
  | { type: 'focus'; name: string }
  /** Realtime thoughts land whenever they arrive; lockstep waits for every answer before each tick, so the run repeats exactly. */
  | { type: 'thinkMode'; mode: 'realtime' | 'lockstep' }
  /** Ask for the decision log (answered with a `log` message). */
  | { type: 'saveLog' }
  /** Restart and rerun from a decision log without calling the model. */
  | { type: 'replay'; log: DecisionLog }

export type DecisionLog = { tick: number; set: number; row: number; decision: unknown }[]

/** One frame of one world. */
export interface WorldFrameMsg {
  name?: string
  color?: string
  scale?: number
  kind: 'agents' | 'lattice' | 'bodies' | 'graph'
  count: number
  size: number
  unit: number
  pos: Float32Array
  vel: Float32Array | null
  attr: Float32Array | null
  lattice?: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number; palette?: string[]; thickness?: number }
  rigid?: RigidFrame
  graph?: { edges: Uint32Array; version: number; palette?: string[]; nodeSize: number }
}

export type FromWorker =
  | { type: 'tiles'; tick: number; rate: number; stepMs: number; tiles: { name: string; params: Record<string, number>; metrics: Record<string, number> | null; frames: WorldFrameMsg[] }[] }
  | { type: 'focused'; params: Record<string, number> }
  | { type: 'controllers'; names: string[] }
  | { type: 'log'; log: DecisionLog }
  | { type: 'frame'; tick: number; think: { enabled: boolean; mode: 'realtime' | 'lockstep'; decisions: number; replaying: boolean }; inspected: Inspected | null; frames: WorldFrameMsg[]; rate: number; metrics: Record<string, number> | null; stepMs: number }
  | { type: 'problems'; scene: string[]; script: string[]; runtime: string[] }

let sim: Sim | null = null
let scene: Scene | null = null
let sceneText = ''
let script: ScriptModule | null = null
let running = true
let sceneErrors: string[] = []
let scriptErrors: string[] = []
let lastSent = ''
let selection: { set: number; row: number } | null = null
// sweep mode: many sims in one group, ticking together
let group: SimGroup | null = null
let sweepRuns = new Map<string, Record<string, number>>()

function applyScene(text: string): void {
  sceneText = text
  const r = parseScene(text)
  if (r.ok) {
    scene = r.scene
    sceneErrors = []
    sim?.setScene(r.scene)
    if (group) for (const [name, s] of group.sims) s.setScene(withParams(r.scene, sweepRuns.get(name) ?? {}))
  } else {
    sceneErrors = r.errors
  }
}

async function applyScript(code: string): Promise<void> {
  try {
    script = await compile(code)
    scriptErrors = []
    postMessage({ type: 'controllers', names: Object.entries(script).filter(([k, v]) => k !== 'metrics' && !!v && typeof v === 'object' && ['decide', 'update', 'init'].some((f) => typeof (v as Record<string, unknown>)[f] === 'function')).map(([k]) => k) } satisfies FromWorker)
  } catch (e) {
    scriptErrors = [e instanceof Error ? e.message : String(e)]
  }
}

// async because scenes with a physics body wait for the physics engine to load
let builds = 0
/** `ctx.ask` goes through the local server, which holds the API key. */
async function askModel(prompt: string, options?: { json?: boolean }): Promise<string> {
  const r = await fetch('/api/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, json: options?.json === true }) })
  const body = (await r.json()) as { text?: string; error?: string }
  if (!r.ok || body.text === undefined) throw new Error(body.error ?? `the model request failed (${r.status})`)
  return body.text
}

async function rebuild(): Promise<void> {
  if (!scene) return
  const mine = ++builds
  const next = await Sim.create(scene, script ?? undefined)
  next.provider = askModel
  if (mine !== builds) return next.dispose() // a newer rebuild started while this one loaded
  sim?.dispose()
  sim = next
}

let lastPosted = -1
let thinkMode: 'realtime' | 'lockstep' = 'realtime'
let lockBusy = false // a lockstep tick is waiting for its answers
let stepMs = 0 // smoothed time one tick takes, shown in the stats line

function transfers(f: WorldFrameMsg): ArrayBuffer[] {
  return [f.pos.buffer as ArrayBuffer, ...(f.vel ? [f.vel.buffer as ArrayBuffer] : []), ...(f.attr ? [f.attr.buffer as ArrayBuffer] : []), ...(f.lattice ? [f.lattice.show.buffer as ArrayBuffer] : []), ...(f.rigid ? [f.rigid.poses.buffer as ArrayBuffer] : []), ...(f.graph ? [f.graph.edges.buffer as ArrayBuffer] : [])]
}

let groupTick = -1

function postGroup(): void {
  if (!group) return
  const first = group.sims.values().next().value as Sim | undefined
  if (first && first.tick !== groupTick) {
    groupTick = first.tick
    const all = first.tick % 4 === 0 || first.rate < 30
    const tiles = [...group.sims].map(([name, s]) => ({ name, params: sweepRuns.get(name) ?? {}, metrics: all ? s.metrics() : null, frames: s.frames() }))
    postMessage({ type: 'tiles', tick: first.tick, rate: first.rate, stepMs, tiles } satisfies FromWorker, tiles.flatMap((t) => t.frames.flatMap(transfers)))
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
    const frames = sim.frames()
    const m = sim.tick % 4 === 0 || sim.rate < 30 ? sim.metrics() : null
    const inspected = selection ? sim.inspect(selection.set, selection.row) : null
    const msg: FromWorker = { type: 'frame', tick: sim.tick, think: { enabled: sim.thinks, mode: thinkMode, decisions: sim.decisionLog.length, replaying: sim.isReplaying }, inspected, metrics: m, stepMs, rate: sim.rate, frames }
    postMessage(msg, frames.flatMap(transfers))
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
      else if (thinkMode === 'lockstep' && sim!.thinks) {
        if (lockBusy) break // the model has not answered yet: the clock waits
        lockBusy = true
        const s = sim!
        void s.think().then(() => { s.step(); lastPosted = -1 }).finally(() => { lockBusy = false })
      } else { sim!.thinkInBackground(); sim!.step() } // slow thoughts (model calls) run beside the clock and land when they arrive
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
    case 'keys':
      sim?.setInput(m.keys)
      break
    case 'inspect':
      selection = { set: m.set, row: m.row }
      lastPosted = -1
      break
    case 'uninspect':
      selection = null
      break
    case 'poke':
      try {
        sim?.poke(m.set, m.row, m.field, m.value, m.index)
        lastPosted = -1 // show the new value even while paused
      } catch (e) {
        postMessage({ type: 'problems', scene: sceneErrors, script: scriptErrors, runtime: [e instanceof Error ? e.message : String(e)] } satisfies FromWorker)
      }
      break
    case 'play':
      running = m.running
      break
    case 'step':
      if (group) group.step()
      else if (sim && thinkMode === 'lockstep') { await sim.think(); sim.step() }
      else sim?.step()
      break
    case 'thinkMode':
      thinkMode = m.mode
      lastPosted = -1
      break
    case 'saveLog':
      postMessage({ type: 'log', log: sim?.decisionLog ?? [] } satisfies FromWorker)
      break
    case 'replay':
      applyScene(sceneText)
      await rebuild()
      sim?.replay(m.log)
      lastPosted = -1
      break
    case 'sweep':
      if (!scene) break
      try {
        group?.dispose()
        group = null
        const g = await SimGroup.fromRuns(scene, script ?? undefined, m.runs)
        group = g
        sweepRuns = new Map(m.runs.map((r) => [r.name, r.params]))
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
      const params = sweepRuns.get(m.name) ?? {}
      let copy: Sim
      try {
        copy = group.get(m.name).fork()
      } catch {
        // physics scenes cannot be forked yet: start a fresh run with that param value instead
        copy = await Sim.create(withParams(scene!, params), script ?? undefined)
      }
      group?.dispose()
      group = null
      sim?.dispose()
      sim = copy
      lastPosted = -1
      postMessage({ type: 'focused', params } satisfies FromWorker)
      break
    }
    case 'reset':
      applyScene(sceneText)
      if (group && scene) {
        const names = [...group.sims.keys()]
        group.dispose()
        group = await SimGroup.fromRuns(scene, script ?? undefined, names.map((n) => ({ name: n, params: sweepRuns.get(n) ?? {} })))
        groupTick = -1
      } else await rebuild()
      break
  }
}
