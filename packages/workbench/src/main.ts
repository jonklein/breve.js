import { Viewport, type WorldLook } from './viewport'
import { TileGrid } from './tiles'
import { makeEditor, setParamInText } from './editors'
import { ParamsPanel, MetricsPanel } from './panel'
import {
  clearDoc, createProject, deleteProject, fetchExample, loadExamples, renameProject, saveDoc, savedDoc, userProjects,
  type Doc, type ExampleInfo,
} from './projects'
import { ChatPanel } from './chat'
import type { FromWorker, ToWorker } from './sim.worker'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

async function main(): Promise<void> {
  const examples = await loadExamples()
  const exampleById = new Map(examples.map((e) => [e.id, e]))
  const isExample = (id: string) => exampleById.has(id)

  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
  const send = (m: ToWorker) => worker.postMessage(m)

  const viewport = new Viewport($('viewport'))
  const metrics = new MetricsPanel($('metrics'))

  // ---- sweep: the same scene many times over, side by side ----
  let sweeping = false
  const tiles = new TileGrid($('tiles'), (name) => send({ type: 'focus', name }))
  const sweepParam = $<HTMLSelectElement>('sweep-param')
  const sweepFrom = $<HTMLInputElement>('sweep-from')
  const sweepTo = $<HTMLInputElement>('sweep-to')
  const paramRange = (name: string) => {
    try {
      const v = (JSON.parse(sceneEditor.getText()).params ?? {})[name]
      if (typeof v === 'number') return { min: Math.min(0, v * 2), max: Math.max(1, v * 2), step: 0 }
      return { min: v.min ?? 0, max: v.max ?? v.value * 2, step: v.step ?? 0 }
    } catch { return { min: 0, max: 1, step: 0 } }
  }
  const fillSweepBar = () => {
    let names: string[] = []
    try { names = Object.keys(JSON.parse(sceneEditor.getText()).params ?? {}) } catch { /* the scene is mid-edit */ }
    const keep = sweepParam.value
    sweepParam.replaceChildren(...names.map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n })))
    sweepParam.value = names.includes(keep) ? keep : names.find((n) => n !== 'count') ?? names[0] ?? ''
    const r = paramRange(sweepParam.value)
    sweepFrom.value = String(r.min)
    sweepTo.value = String(r.max)
  }
  const showSweep = (on: boolean) => {
    sweeping = on
    viewport.setVisible(!on)
    tiles.setVisible(on)
    $('sweep-exit').classList.toggle('hidden', !on)
  }
  const leaveSweep = () => {
    if (!sweeping) return
    showSweep(false)
    send({ type: 'single' })
  }
  $('sweep').addEventListener('click', () => {
    const bar = $('sweepbar')
    const opening = bar.classList.contains('hidden')
    bar.classList.toggle('hidden', !opening)
    if (opening) fillSweepBar()
    else leaveSweep()
  })
  sweepParam.addEventListener('change', () => {
    const r = paramRange(sweepParam.value)
    sweepFrom.value = String(r.min)
    sweepTo.value = String(r.max)
  })
  $('sweep-run').addEventListener('click', () => {
    const n = Number($<HTMLSelectElement>('sweep-count').value)
    const lo = Number(sweepFrom.value), hi = Number(sweepTo.value)
    const step = paramRange(sweepParam.value).step
    const round = (v: number) => Number((step > 0 ? Math.round(v / step) * step : v).toPrecision(6))
    const values = [...new Set(Array.from({ length: n }, (_, i) => round(n === 1 ? lo : lo + ((hi - lo) * i) / (n - 1))))]
    tiles.clear()
    try { tiles.setMetric(JSON.parse(sceneEditor.getText()).metrics?.[0] ?? '') } catch { tiles.setMetric('') }
    showSweep(true)
    send({ type: 'sweep', param: sweepParam.value, values })
  })
  $('sweep-exit').addEventListener('click', leaveSweep)
  let current = ''
  let loading = false // true while we write to the editors ourselves, so edits aren't saved or echoed
  const timers: Record<string, number> = {}
  const debounce = (k: string, fn: () => void) => {
    clearTimeout(timers[k])
    timers[k] = window.setTimeout(fn, 120)
  }

  const projectName = () => exampleById.get(current)?.name ?? userProjects().find((p) => p.id === current)?.name ?? 'project'
  const docNow = (): Doc => ({ scene: sceneEditor.getText(), script: scriptEditor.getText() })

  const params = new ParamsPanel($('params'), (name, value) => {
    const next = setParamInText(sceneEditor.getText(), name, value)
    if (next === null) return
    loading = true
    sceneEditor.setText(next)
    loading = false
    saveDoc(current, docNow())
    send({ type: 'scene', scene: next })
  })

  const showScene = (text: string) => {
    try {
      const scene = JSON.parse(text) as { params?: unknown; world?: WorldLook; entities?: { controller?: string }[] }
      params.render(scene.params)
      viewport.setWorld(scene.world)
      tiles.setWorld(scene.world)
      $('script-tab').textContent = scene.entities?.[0]?.controller ?? 'script.js'
    } catch { /* keep the last good sliders and look */ }
  }

  const sceneEditor = makeEditor($('editor-scene'), '', 'json', (text) => {
    if (loading) return
    saveDoc(current, docNow())
    showScene(text)
    debounce('scene', () => send({ type: 'scene', scene: text }))
  })
  const scriptEditor = makeEditor($('editor-script'), '', 'js', (text) => {
    if (loading) return
    saveDoc(current, docNow())
    debounce('script', () => send({ type: 'script', script: text }))
  })
  Object.assign(window, { breve: { sceneEditor, scriptEditor, worker, viewport } }) // handle for poking at it from the console

  // ---- assistant ----
  const chat = new ChatPanel($('chat'), {
    project: () => ({ id: current, name: projectName(), ...docNow() }),
    apply(doc) {
      loading = true
      sceneEditor.setText(doc.scene)
      scriptEditor.setText(doc.script)
      loading = false
      saveDoc(current, doc)
      showScene(doc.scene)
      send({ type: 'scene', scene: doc.scene })
      send({ type: 'script', script: doc.script })
    },
    scriptName: () => $('script-tab').textContent ?? 'script.js',
  })
  void chat.init()

  // ---- projects: examples and your own forks ----
  const picker = $<HTMLSelectElement>('project')
  const nameBox = $<HTMLInputElement>('name')

  const renderPicker = () => {
    picker.replaceChildren()
    const group = (label: string, items: { id: string; name: string }[]) => {
      if (!items.length) return
      const g = document.createElement('optgroup')
      g.label = label
      for (const it of items) {
        const o = document.createElement('option')
        o.value = it.id
        o.textContent = it.name
        g.appendChild(o)
      }
      picker.appendChild(g)
    }
    group('Examples', examples)
    group('My projects', userProjects())
    picker.value = current
    const mine = !isExample(current)
    nameBox.classList.toggle('hidden', !mine)
    $('delete').classList.toggle('hidden', !mine)
    $('restore').classList.toggle('hidden', mine)
    if (mine) nameBox.value = userProjects().find((p) => p.id === current)?.name ?? ''
  }

  const getDoc = async (id: string): Promise<Doc | null> => {
    const saved = savedDoc(id)
    if (saved) return saved
    const ex = exampleById.get(id)
    return ex ? fetchExample(ex as ExampleInfo) : null
  }

  async function open(id: string): Promise<void> {
    const doc = await getDoc(id)
    if (!doc) return open(examples[0].id)
    current = id
    chat.setProject(id)
    loading = true
    sceneEditor.setText(doc.scene)
    scriptEditor.setText(doc.script)
    loading = false
    metrics.clear()
    if (sweeping) showSweep(false)
    $('sweepbar').classList.add('hidden')
    showScene(doc.scene)
    renderPicker()
    history.replaceState(null, '', '#' + id)
    send({ type: 'init', scene: doc.scene, script: doc.script })
  }

  picker.addEventListener('change', () => open(picker.value))
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== current) open(id) })

  $('fork').addEventListener('click', () => {
    const base = isExample(current) ? exampleById.get(current)!.name : userProjects().find((p) => p.id === current)?.name ?? 'Project'
    const p = createProject(`${base} copy`, current, docNow())
    open(p.id).then(() => { nameBox.focus(); nameBox.select() })
  })

  nameBox.addEventListener('input', () => {
    renameProject(current, nameBox.value || 'Untitled')
    const opt = [...picker.options].find((o) => o.value === current)
    if (opt) opt.textContent = nameBox.value || 'Untitled'
  })

  let armed = 0
  $('delete').addEventListener('click', () => {
    if (!armed) {
      $('delete').textContent = 'Really delete?'
      armed = window.setTimeout(() => { armed = 0; $('delete').textContent = 'Delete' }, 3000)
      return
    }
    clearTimeout(armed)
    armed = 0
    $('delete').textContent = 'Delete'
    const from = userProjects().find((p) => p.id === current)?.from
    deleteProject(current)
    open(from && isExample(from) ? from : examples[0].id)
  })

  $('restore').addEventListener('click', () => {
    clearDoc(current)
    open(current)
  })

  // ---- editor tabs and transport ----
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b))
      $('editor-scene').classList.toggle('hidden', b.dataset.tab !== 'scene')
      $('editor-script').classList.toggle('hidden', b.dataset.tab !== 'script')
      $('chat').classList.toggle('hidden', b.dataset.tab !== 'chat')
    }),
  )

  let running = true
  $('play').addEventListener('click', () => {
    running = !running
    $('play').textContent = running ? 'Pause' : 'Play'
    send({ type: 'play', running })
  })
  $('step').addEventListener('click', () => send({ type: 'step' }))
  $('reset').addEventListener('click', () => { metrics.clear(); tiles.resetHistory(); send({ type: 'reset' }) })

  const status = $('status')
  const problems = $('problems')
  const showProblems = (scene: string[], script: string[], runtime: string[]) => {
    problems.replaceChildren()
    const add = (where: string, msgs: string[]) =>
      msgs.forEach((m) => {
        const li = document.createElement('li')
        const w = document.createElement('span')
        w.className = 'where'
        w.textContent = where
        li.append(w, m)
        problems.appendChild(li)
      })
    add('scene.json', scene)
    add($('script-tab').textContent ?? 'script', script)
    add('runtime', runtime)
    const bad = scene.length + script.length + runtime.length > 0
    status.textContent = bad ? 'error · last good version still running' : 'ok · live'
    status.className = 'status ' + (bad ? 'bad' : 'ok')
  }

  let lastTick = 0
  let lastTime = performance.now()
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data
    if (m.type === 'frame') {
      viewport.update(m)
      if (m.metrics) metrics.push(m.metrics)
      const now = performance.now()
      if (now - lastTime > 500) {
        const tps = Math.max(0, ((m.tick - lastTick) * 1000) / (now - lastTime))
        lastTick = m.tick
        lastTime = now
        $('stats').textContent = `tick ${m.tick} · ${m.count} ${m.kind === 'lattice' ? 'live cells' : 'agents'} · ${tps.toFixed(0)} ticks/s · ${m.stepMs.toFixed(1)} ms/tick`
      }
    } else if (m.type === 'tiles') {
      if (sweeping) tiles.update(m.tiles, '')
      const now = performance.now()
      if (now - lastTime > 500) {
        const tps = Math.max(0, ((m.tick - lastTick) * 1000) / (now - lastTime))
        lastTick = m.tick
        lastTime = now
        $('stats').textContent = `tick ${m.tick} · ${m.tiles.length} runs · ${tps.toFixed(0)} ticks/s · ${m.stepMs.toFixed(1)} ms/tick (all runs)`
      }
    } else if (m.type === 'focused') {
      // continue from the picked tile: make its param value the scene's own, and go back to the big view
      const next = setParamInText(sceneEditor.getText(), m.param, m.value)
      if (next !== null) {
        loading = true
        sceneEditor.setText(next)
        loading = false
        saveDoc(current, docNow())
        showScene(next)
      }
      showSweep(false)
      $('sweepbar').classList.add('hidden')
    } else if (m.type === 'problems') {
      showProblems(m.scene, m.script, m.runtime)
    }
  }

  const start = location.hash.slice(1)
  await open(start && (isExample(start) || userProjects().some((p) => p.id === start)) ? start : examples[0].id)
}

main()
