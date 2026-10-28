import './engines'
import { compile } from './script-load'
import { loadSceneModels } from '@breve/inference'
import { Defaults } from '@breve/stdlib'
import { ParentRun, Pacer, stepsPerSecond, type ViewerSpeed, parentOf, registerAssetReader, Sim, SimGroup, type Parent, type SimSnapshot, type Inspected, parseScene, withParams, type RigidFrame, type Scene, type ScriptModule } from '@breve/core'
import { site } from './site-root'

export type ToWorker =
  /** `base` is where a scene's relative model paths start (the example's folder). */
  | { type: 'init'; scene: string; script: string; base?: string; /** Which opening of a project this is: frames carry it back so the page can drop ones from a project it has left. */ epoch?: number }
  | { type: 'scene'; scene: string }
  | { type: 'script'; script: string }
  | { type: 'play'; running: boolean }
  /** How fast to run: `null` is the scene's own pace, `"max"` flat out, a number a multiple of the scene's pace. */
  | { type: 'speed'; value: ViewerSpeed }
  | { type: 'step' }
  | { type: 'reset' }
  /** Zoom and pan a lattice kept on the graphics card: which part of the grid (left, top, right, bottom in cells) to draw, in how many pixels. */
  | { type: 'fieldView'; set: number; window: [number, number, number, number]; width: number; height: number }
  /** The keys held down in the view, for human-driven controllers. */
  | { type: 'keys'; keys: string[] }
  /** Watch one entity (or nothing). Its fields come back with every frame. */
  | { type: 'inspect'; set: number; row: number }
  | { type: 'uninspect' }
  /** Edit one value of one entity. */
  | { type: 'move'; set: number; row: number; x: number; z: number }
  | { type: 'poke'; set: number; row: number; field: string; value: number | boolean | string; index?: number }
  /** Run the scene once per value of one param, side by side. */
  | { type: 'sweep'; runs: { name: string; params: Record<string, number> }[] }
  /** Leave the sweep. */
  | { type: 'single' }
  /** Continue from one sweep tile as the single sim. */
  | { type: 'focus'; name: string }
  /** Go back from one picked sim to the whole population, exactly where it was left. */
  | { type: 'unfocus' }
  /** Go back to the recorded moment at or before this tick, and pause there. Playing on from it starts a new branch. */
  | { type: 'seek'; tick: number }
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
  style?: import('@breve/core').SetStyle
  kind: 'agents' | 'lattice' | 'bodies' | 'graph' | 'field'
  count: number
  size: number
  unit: number
  pos: Float32Array
  vel: Float32Array | null
  look?: { rgb: Uint8Array | null; visible: Uint8Array | null; alpha: Uint8Array | null; scale: Float32Array | null }
  lattice?: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number; thickness?: number; rgb?: Uint8Array; alpha?: Uint8Array; sizes?: Float32Array }
  rigid?: RigidFrame
  graph?: { edges: Uint32Array; version: number; nodeSize: number; linkOpacity: number; linkBrightness: number }
  field?: { dims: [number, number]; spacing: number; width: number; height: number; pixels: Uint8Array; window: [number, number, number, number] }
}

export type FromWorker =
  | { type: 'population'; on: boolean }
  /** Where you are in a multi-sim setup, root first: `['All runs', 'c04']`. Empty when there is nothing to go back to. */
  | { type: 'crumbs'; trail: string[] }
  | { type: 'tiles'; epoch: number; tick: number; time: number; unit: string; rate: number; pace: number; stepMs: number; /** a parent's progress line, when a parent runs the sims */ status?: string; tiles: { name: string; params: Record<string, number>; metrics: Record<string, number> | null; frames: WorldFrameMsg[] }[] }
  | { type: 'focused'; params: Record<string, number> }
  | { type: 'controllers'; names: string[] }
  | { type: 'log'; log: DecisionLog }
  /** The metric samples up to a moment, after a seek: the charts redraw from them. */
  | { type: 'metrics'; samples: Record<string, number>[] }
  | { type: 'frame'; epoch: number; tick: number; think: { enabled: boolean; mode: 'realtime' | 'lockstep'; decisions: number; replaying: boolean; complete: boolean }; /** Sets whose behavior depends on something outside the sim, so a fork or rerun may differ. */ nondeterministic: string[]; /** The moments that can be returned to, or null when this sim cannot be snapshotted. */ timeline: { first: number; last: number; step: number } | null; inspected: Inspected | null; frames: WorldFrameMsg[]; /** Simulated time so far, and what it counts. */ time: number; unit: string; /** Steps per real second now, and simulated time per real second now (the achieved pace). */ rate: number; pace: number; metrics: Record<string, number> | null; stepMs: number }
  | { type: 'problems'; scene: string[]; script: string[]; runtime: string[] }

let sim: Sim | null = null
let scene: Scene | null = null
let sceneText = ''
let script: ScriptModule | null = null
let running = true
let sceneErrors: string[] = []
let scriptErrors: string[] = []
let epoch = 0
let lastSent = ''
let selection: { set: number; row: number } | null = null
// sweep mode: many sims in one group, ticking together
let group: SimGroup | null = null
let sweepRuns = new Map<string, Record<string, number>>()
// population mode: the script's `parent` makes and replaces the sims in `group` (an evolving population)
let population: ParentRun | null = null
let parked: { run: ParentRun; name: string } | null = null // the population, paused, while one of its sims is open alone
let populationBusy = false // the parent is between generations, adding sims

function applyScene(text: string): void {
  sceneText = text
  const r = parseScene(text)
  if (r.ok) {
    scene = r.scene
    sceneErrors = []
    sim?.setScene(r.scene)
    if (population || parked) (population ?? parked!.run).setScene(r.scene) // its sub-sims keep the scenes the parent made for them
    else if (group) for (const [name, s] of group.sims) s.setScene(withParams(r.scene, sweepRuns.get(name) ?? {}))
  } else {
    sceneErrors = r.errors
  }
}

async function applyScript(code: string): Promise<void> {
  try {
    script = await compile(code)
    scriptErrors = []
    postMessage({ type: 'controllers', names: Object.entries(script).filter(([k, v]) => k !== 'metrics' && !!v && typeof v === 'object' && ['act', 'actAll', 'actFormula', 'init', 'initAll', 'initFormula'].some((f) => typeof (v as Record<string, unknown>)[f] === 'function')).map(([k]) => k) } satisfies FromWorker)
  } catch (e) {
    scriptErrors = [e instanceof Error ? e.message : String(e)]
  }
}

// async because scenes with a physics body wait for the physics engine to load
let builds = 0
/** `ctx.ask` goes through the local server, which holds the API key. */
async function askModel(prompt: string, options?: { json?: boolean; images?: string[] }): Promise<string> {
  const r = await fetch(site('api/decide'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, json: options?.json === true, images: options?.images }) })
  const body = (await r.json()) as { text?: string; error?: string }
  if (!r.ok || body.text === undefined) throw new Error(body.error ?? `the model request failed (${r.status})`)
  return body.text
}

function leavePopulation(): void {
  population?.dispose()
  population = null
  parked?.run.dispose()
  parked = null
  postMessage({ type: 'crumbs', trail: [] } satisfies FromWorker)
  group = null
  postMessage({ type: 'population', on: false } satisfies FromWorker)
}

async function startPopulation(parent: Parent, mine: number): Promise<void> {
  const run = new ParentRun(parent, scene!, script ?? undefined)
  populationBusy = true
  try {
    await run.start()
  } catch (e) {
    run.dispose()
    sceneErrors = [`parent: ${e instanceof Error ? e.message : String(e)}`]
    populationBusy = false
    return
  }
  populationBusy = false
  if (mine !== builds) return run.dispose() // a newer rebuild started while this one loaded
  sim?.dispose()
  sim = null
  population?.dispose()
  parked?.run.dispose()
  parked = null
  population = run
  group = run.group
  groupTick = -1
  lastSent = ''
  postMessage({ type: 'population', on: true } satisfies FromWorker)
  postMessage({ type: 'crumbs', trail: ['All runs'] } satisfies FromWorker)
}

let replayLog: { tick: number; set: number; row: number; decision: unknown }[] | null = null // a log to replay on the next sim built

async function rebuild(): Promise<void> {
  if (!scene) return
  const mine = ++builds
  const parent = parentOf(script)
  if (parent) return startPopulation(parent, mine)
  if (population || parked) leavePopulation()
  let next: Sim
  try {
    next = await Sim.create(scene, script ?? undefined)
  } catch (e) {
    // a scene that cannot be built (a grid too big for this machine, a missing engine) is explained in the problems list, not lost
    if (mine !== builds) return
    sim?.dispose()
    sim = null
    lastSent = ''
    postMessage({ type: 'problems', scene: sceneErrors, script: scriptErrors, runtime: [e instanceof Error ? e.message : String(e)] } satisfies FromWorker)
    return
  }
  next.provider = askModel
  // a replay must be set before the new sim can take a step, or its first thoughts would ask the model
  if (replayLog && mine === builds) { next.replay(replayLog); replayLog = null }
  if (mine !== builds) return next.dispose() // a newer rebuild started while this one loaded
  sim?.dispose()
  sim = next
  modelsKey = ''
  resetTimeline(next)
  await syncModels()
}

let lastPosted = -1
let modelBase = ''
let modelsKey = '' // the scene's `models` as last loaded
let modelProblems: string[] = []

/** Load the models the scene declares (again when they change) into the running sim. */
async function syncModels(): Promise<void> {
  if (!sim || !scene) return
  const key = JSON.stringify(scene.models ?? {})
  if (key === modelsKey) return
  modelsKey = key
  for (const k of Object.keys(sim.models)) { void sim.models[k].dispose?.(); delete sim.models[k] }
  const target = sim
  modelProblems = await loadSceneModels(target, { base: modelBase || undefined })
  lastSent = '' // show (or clear) the problems
}
/** Controllers that declare themselves non-deterministic (a person at the keyboard), sets that ask a language model, and GPU models; none while a log is replayed. */
const flagged = (s: Sim): string[] => s.nondeterministic()
let thinkMode: 'realtime' | 'lockstep' = 'realtime'
let lockBusy = false // a lockstep tick is waiting for its answers

// ---- timeline: a snapshot every few ticks, within a memory budget, so a run can be scrubbed and resumed from any point ----
const HISTORY_EVERY = 10
const HISTORY_BYTES = 64_000_000
let history: { tick: number; snap: SimSnapshot }[] = []
let historyCap = 0 // how many snapshots fit; worked out from the first one
let timelineOff = false // this kind of sim cannot be snapshotted (yet)
let metricLog: { tick: number; m: Record<string, number> }[] = []

const bytesOf = (v: unknown): number => {
  if (ArrayBuffer.isView(v)) return v.byteLength
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + bytesOf(x), 0)
  if (v && typeof v === 'object') return Object.values(v).reduce((n: number, x) => n + bytesOf(x), 0)
  return 0
}

function recordMoment(s: Sim): void {
  if (timelineOff || group || s !== sim || s.tick % HISTORY_EVERY !== 0) return
  // playing on from an earlier moment starts a new branch: whatever was recorded after this tick is gone
  while (history.length && history[history.length - 1].tick >= s.tick) history.pop()
  try {
    const snap = s.snapshot()
    if (!historyCap) historyCap = Math.max(3, Math.min(400, Math.floor(HISTORY_BYTES / Math.max(1, bytesOf(snap)))))
    history.push({ tick: s.tick, snap })
    if (history.length > historyCap) history.shift()
  } catch {
    timelineOff = true
    history = []
  }
}

function resetTimeline(s: Sim): void {
  history = []
  historyCap = 0
  timelineOff = false
  metricLog = []
  recordMoment(s)
}

const timeline = () => (history.length > 1 ? { first: history[0].tick, last: history[history.length - 1].tick, step: HISTORY_EVERY } : null)
let stepMs = 0 // smoothed time one tick takes, shown in the stats line

function transfers(f: WorldFrameMsg): ArrayBuffer[] {
  const buffers = (...arrays: (ArrayBufferView | null | undefined)[]) => arrays.filter((a): a is ArrayBufferView => !!a).map((a) => a.buffer as ArrayBuffer)
  return buffers(f.pos, f.vel, f.look?.rgb, f.look?.visible, f.look?.alpha, f.look?.scale, f.lattice?.show, f.lattice?.rgb, f.lattice?.alpha, f.lattice?.sizes, f.rigid?.poses, f.graph?.edges, f.field?.pixels)
}

let groupTick = -1
let achievedRate = 0 // steps per real second over the last half second
let windowSteps = 0
let windowSeconds = 0

function postGroup(): void {
  if (!group) return
  const first = group.sims.values().next().value as Sim | undefined
  if (first && first.tick !== groupTick) {
    groupTick = first.tick
    const all = first.tick % 4 === 0 || achievedRate < 30
    const tiles = [...group.sims].map(([name, s]) => ({ name, params: sweepRuns.get(name) ?? {}, metrics: all ? s.metrics() : null, frames: s.frames() }))
    postMessage({ type: 'tiles', epoch, tick: population ? population.tick : first.tick, time: first.time, unit: first.unit, rate: achievedRate, pace: achievedRate * first.stepTime, stepMs, status: population?.status(), tiles } satisfies FromWorker, tiles.flatMap((t) => t.frames.flatMap(transfers)))
  }
  const runtime = [...new Set([...group.sims.values()].flatMap((s) => s.takeErrors()))]
  const problems = JSON.stringify([sceneErrors, scriptErrors, runtime])
  if (problems !== lastSent || runtime.length) {
    lastSent = problems
    postMessage({ type: 'problems', scene: sceneErrors, script: scriptErrors, runtime } satisfies FromWorker)
  }
}

function stepPopulation(): void {
  const run = population
  if (!run) return
  populationBusy = true
  run.step().catch((e) => { sceneErrors = [`parent: ${e instanceof Error ? e.message : String(e)}`]; running = false }).finally(() => { populationBusy = false })
}

let refreshing = false // a lattice kept on the graphics card is bringing its picture and totals back
let pictureReady = false // ...and has brought them: the next frame can go out

function post(): void {
  if (population?.mutating) return // a new generation is being made: wait until it is whole
  if (group) return postGroup()
  if (!sim) return
  // A lattice on the graphics card must have its picture fetched before a frame can be sent. Ticks wait for the fetch (see the step loop),
  // so the card is never far ahead of what is shown, and the frame that follows is the one that was fetched, not a newer one.
  const card = sim.onGraphicsCard
  if (card && !refreshing && !pictureReady && sim.tick !== lastPosted) {
    refreshing = true
    const s = sim
    void s.refresh().catch(() => {}).finally(() => { refreshing = false; pictureReady = true })
  }
  if (sim.tick !== lastPosted && (!card || pictureReady)) {
    lastPosted = sim.tick
    pictureReady = false
    const frames = sim.frames()
    const m = sim.tick % 4 === 0 || achievedRate < 30 || card ? sim.metrics() : null // totals from a graphics card are already in hand
    if (m) { metricLog.push({ tick: sim.tick, m }); if (metricLog.length > 600) metricLog.shift() }
    const inspected = selection ? sim.inspect(selection.set, selection.row) : null
    const msg: FromWorker = { type: 'frame', epoch, tick: sim.tick, think: { enabled: sim.thinks, mode: thinkMode, decisions: sim.decisionLog.length, replaying: sim.isReplaying, complete: sim.decisionLogComplete }, nondeterministic: flagged(sim), timeline: timeline(), inspected, metrics: m, stepMs, time: sim.time, unit: sim.unit, rate: achievedRate, pace: achievedRate * sim.stepTime, frames }
    postMessage(msg, frames.flatMap(transfers))
  }
  const runtime = [...modelProblems, ...sim.takeErrors()]
  const problems = JSON.stringify([sceneErrors, scriptErrors, runtime])
  if (problems !== lastSent || runtime.length) {
    lastSent = problems
    postMessage({ type: 'problems', scene: sceneErrors, script: scriptErrors, runtime } satisfies FromWorker)
  }
}

// The clock: each frame runs as many steps as the scene's pace (and the viewer's speed) call for, within what is left of the frame, and
// the picture is updated at the scene's frame rate. A machine that cannot keep up runs fewer steps, it never drops frames.
let viewerSpeed: ViewerSpeed = null
const pacer = new Pacer()
let lastFrame = performance.now()
function frameLoop(): void {
  const driver = group ? group.sims.values().next().value as Sim | undefined : sim
  const time = { step: driver?.stepTime ?? scene?.time?.step ?? Defaults.time.step, pace: driver?.pace ?? scene?.time?.pace ?? Defaults.time.pace }
  const fps = driver?.fps ?? scene?.time?.fps ?? Defaults.time.fps
  const frameStart = performance.now()
  const seconds = Math.min(0.25, (frameStart - lastFrame) / 1000)
  lastFrame = frameStart
  let done = 0
  if (running && (driver || population)) {
    let want = pacer.steps(stepsPerSecond(time, viewerSpeed), seconds)
    const allowed = Math.max(4, 700 / fps) // ms of a frame that stepping may use; the rest is for drawing and for the page
    while (want >= 1) {
      const t0 = performance.now()
      if (population) {
        // a parent's step may add sims (a new generation), which takes a moment: one step at a time
        if (populationBusy) break
        stepPopulation()
        done++
        break
      } else if (group) group.step()
      else if (refreshing) break // the card is still working out the picture: do not queue more steps behind it
      else if (thinkMode === 'lockstep' && sim!.thinks) {
        if (lockBusy) break // the model has not answered yet: the clock waits
        lockBusy = true
        const s = sim!
        void s.think().then(() => { s.step(); recordMoment(s); lastPosted = -1 }).finally(() => { lockBusy = false })
      } else { sim!.thinkInBackground(); sim!.step(); recordMoment(sim!) } // slow thoughts (model calls) run beside the clock and land when they arrive
      stepMs = stepMs * 0.8 + (performance.now() - t0) * 0.2
      done++
      want--
      if (performance.now() - frameStart > allowed) break
    }
  }
  // the speed actually reached, over the last half second or so (a single frame's count is noise)
  windowSteps += done; windowSeconds += seconds
  if (windowSeconds >= 0.5) { achievedRate = windowSteps / windowSeconds; windowSteps = 0; windowSeconds = 0 }
  post()
  setTimeout(frameLoop, Math.max(1, 1000 / fps - (performance.now() - frameStart)))
}
frameLoop()

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data
  switch (m.type) {
    case 'init':
      viewerSpeed = null
      sim?.dispose()
      sim = null
      script = null
      scene = null
      group?.dispose()
      group = null
      lastPosted = -1
      epoch = m.epoch ?? 0
      modelBase = m.base ?? ''
      // a mesh part's shape is read from its model file, next to the scene like any other asset
      registerAssetReader(async (path) => {
        const r = await fetch(new URL(path, modelBase || self.location.href))
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return new Uint8Array(await r.arrayBuffer())
      })
      applyScene(m.scene)
      await applyScript(m.script)
      await rebuild()
      break
    case 'scene':
      applyScene(m.scene)
      await syncModels()
      break
    case 'script':
      await applyScript(m.script)
      if (script) {
        const shape = sim?.stateShape()
        sim?.setScript(script)
        if (population) { await rebuild(); break } // new parent code starts the whole population over
        if (group) for (const s of group.sims.values()) s.setScript(script)
        // a script whose init returns different fields needs different columns: start over rather than run against the old ones
        if (sim && !group && shape !== undefined && shape !== sim.stateShape()) await rebuild()
      }
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
    case 'move': // a person dragged an entity
      try {
        sim?.moveEntity(m.set, m.row, m.x, m.z)
        lastPosted = -1
      } catch { /* a sweep or a lattice has nothing to move */ }
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
    case 'speed':
      viewerSpeed = m.value
      break
    case 'fieldView':
      if (sim) { sim.setFieldView(m.set, { window: m.window, width: m.width, height: m.height }); lastPosted = -1; pictureReady = false } // draw it now, even when paused
      break
    case 'step':
      if (population) { if (!populationBusy) stepPopulation() }
      else if (group) group.step()
      else if (sim && thinkMode === 'lockstep') { await sim.think(); sim.step(); recordMoment(sim) }
      else if (sim) { sim.step(); recordMoment(sim) }
      break
    case 'seek': {
      if (!sim || group) break
      const at = [...history].reverse().find((h) => h.tick <= m.tick)
      if (!at) break
      running = false
      sim.restore(at.snap)
      metricLog = metricLog.filter((x) => x.tick <= at.tick)
      postMessage({ type: 'metrics', samples: metricLog.map((x) => x.m) } satisfies FromWorker)
      lastPosted = -1
      break
    }
    case 'thinkMode':
      thinkMode = m.mode
      lastPosted = -1
      break
    case 'saveLog':
      postMessage({ type: 'log', log: sim?.decisionLog ?? [] } satisfies FromWorker)
      break
    case 'replay':
      applyScene(sceneText)
      replayLog = m.log
      sim?.replay(m.log) // the sim that is still running while the new one is built must stop asking now
      await rebuild()
      lastPosted = -1
      break
    case 'sweep':
      if (!scene || population) break
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
      if (population) break
      group?.dispose()
      group = null
      lastPosted = -1
      break
    case 'focus': {
      if (!group || !group.sims.has(m.name)) break
      const params = sweepRuns.get(m.name) ?? {}
      let copy: Sim
      try {
        copy = population ? await Sim.create(group.get(m.name).scene, script ?? undefined) : group.get(m.name).fork()
      } catch {
        // physics scenes cannot be forked yet: start a fresh run with that param value instead
        copy = await Sim.create(withParams(scene!, params), script ?? undefined)
      }
      if (population) {
        // keep the population, paused, so "All runs" can return to it exactly as it was
        parked = { run: population, name: m.name }
        population = null
        group = null
        postMessage({ type: 'crumbs', trail: ['All runs', m.name] } satisfies FromWorker)
      }
      group?.dispose()
      group = null
      sim?.dispose()
      sim = copy
      lastPosted = -1
      postMessage({ type: 'focused', params } satisfies FromWorker)
      break
    }
    case 'unfocus':
      if (!parked) break
      sim?.dispose()
      sim = null
      population = parked.run
      parked = null
      group = population.group
      groupTick = -1
      lastSent = ''
      postMessage({ type: 'population', on: true } satisfies FromWorker)
      postMessage({ type: 'crumbs', trail: ['All runs'] } satisfies FromWorker)
      break
    case 'reset':
      applyScene(sceneText)
      if (population) await rebuild()
      else if (group && scene) {
        const names = [...group.sims.keys()]
        group.dispose()
        group = await SimGroup.fromRuns(scene, script ?? undefined, names.map((n) => ({ name: n, params: sweepRuns.get(n) ?? {} })))
        groupTick = -1
      } else await rebuild()
      break
  }
}
