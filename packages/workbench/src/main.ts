import { Viewport, type WorldLook } from './viewport'
import { TileGrid } from './tiles'
import { makeEditor, setParamInText } from './editors'
import { parseScene, sceneSchema, setEntityKey } from '@breve/core'
import { ParamsPanel, MetricsPanel } from './panel'
import {
  approveProject, clearDoc, createProject, deleteProject, fetchExample, fingerprint, loadExamples, renameProject, sameDoc, saveDoc as storeDoc, savedDoc, saveParams, savedParams, userProjects,
  type Doc, type ExampleInfo,
} from './projects'
import { ChatPanel } from './chat'
import { DocsPanel } from './docs'
import { InspectorPanel } from './inspector'
import { decodeShare, encodeShare } from './share'
import { ExperimentPanel, defaultExperiment } from './experiment-panel'
import { JsonTree } from './tree'
import { experimentSchema, parseExperiment } from '@breve/experiment'
import type { FromWorker, ToWorker } from './sim.worker'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

async function main(): Promise<void> {
  // `?embed` on the page address shows only the running simulation: no header, editors or sliders
  if (new URLSearchParams(location.search).has('embed')) document.body.classList.add('embed')
  const examples = await loadExamples()
  const exampleById = new Map(examples.map((e) => [e.id, e]))
  const isExample = (id: string) => exampleById.has(id)

  let epoch = 0
  const toast = (text: string) => {
    const t = $('toast')
    t.textContent = text
    t.classList.remove('hidden')
    window.setTimeout(() => t.classList.add('hidden'), 9000)
  }
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
  const send = (m: ToWorker) => worker.postMessage(m)

  const viewport = new Viewport($('viewport'))
  const metrics = new MetricsPanel($('metrics'))

  // ---- watching an experiment's runs side by side ----
  let sweeping = false
  const tiles = new TileGrid($('tiles'), (name) => send({ type: 'focus', name }))
  const showSweep = (on: boolean) => {
    sweeping = on
    viewport.setVisible(!on)
    tiles.setVisible(on)
    $('sweepbar').classList.toggle('hidden', !on)
  }
  const leaveSweep = () => {
    if (!sweeping) return
    showSweep(false)
    send({ type: 'single' })
  }
  $('sweep-exit').addEventListener('click', leaveSweep)

  let current = ''
  let loading = false // true while we write to the editors ourselves, so edits aren't saved or echoed
  const timers: Record<string, number> = {}
  const debounce = (k: string, fn: () => void) => {
    clearTimeout(timers[k])
    timers[k] = window.setTimeout(fn, 120)
  }

  const projectName = () => exampleById.get(current)?.name ?? userProjects().find((p) => p.id === current)?.name ?? 'project'
  // A project that came from a shared link carries someone else's code. Until you approve it, workers get a do-nothing
  // script instead, and the real one is only shown in the editor.
  const STUB = 'export default {}\n'
  let unapproved = false
  const live = (script: string) => (unapproved ? STUB : script)
  const docNow = (): Doc => ({ scene: sceneEditor.getText(), script: scriptEditor.getText(), experiment: experimentEditor.getText() })

  // Moving a slider on an example nobody has edited remembers just the values; anything else saves the whole project.
  const rememberParams = (values: Record<string, number>) => {
    if (isExample(current) && !savedDoc(current)) saveParams(current, { ...savedParams(current), ...values })
    else saveDoc(current, docNow())
  }

  const params = new ParamsPanel($('params'), (name, value) => {
    const next = setParamInText(sceneEditor.getText(), name, value)
    if (next === null) return
    loading = true
    sceneEditor.setText(next)
    loading = false
    rememberParams({ [name]: value })
    send({ type: 'scene', scene: next })
  })

  const showScene = (text: string) => {
    try {
      const scene = JSON.parse(text) as { params?: unknown; world?: WorldLook; entities?: { controller?: string }[] }
      params.render(scene.params)
      metrics.setGroups((scene as { charts?: { title?: string; metrics: string[] }[] }).charts)
      viewport.setWorld(scene.world)
      tiles.setWorld(scene.world)
      $('script-tab').textContent = scene.entities?.[0]?.controller ?? 'script.js'
    } catch { /* keep the last good sliders and look */ }
  }

  // ---- the tree view: a second way to edit scene.json and experiment.json, over the same text ----
  // JSON opens as a tree of fields; the text view is one click away, and the last choice is remembered
  const pref = (k: string, fallback: string) => { try { return localStorage.getItem(k) ?? fallback } catch { return fallback } }
  const remember = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window: the choice just lasts this visit */ } }
  let treeView = pref('breve.json', 'tree') === 'tree'
  let tab = 'scene'
  const sceneTree = new JsonTree($('tree-scene'), sceneSchema, (text) => sceneEditor.setText(text))
  const experimentTree = new JsonTree($('tree-experiment'), experimentSchema, (text) => experimentEditor.setText(text))
  const checkExperiment = () => {
    const sc = parseScene(sceneEditor.getText())
    const r = parseExperiment(experimentEditor.getText(), sc.ok ? sc.scene : undefined)
    experimentTree.setErrors(r.ok ? [] : r.errors)
  }
  const syncTrees = () => {
    if (!treeView) return
    if (tab === 'scene') sceneTree.setText(sceneEditor.getText())
    if (tab === 'experiment') { experimentTree.setText(experimentEditor.getText()); checkExperiment() }
  }
  const showViews = () => {
    const jsonTab = tab === 'scene' || tab === 'experiment'
    $('view-toggle').classList.toggle('hidden', !jsonTab)
    $('view-toggle').textContent = treeView ? 'Text view' : 'Tree view'
    $('editor-scene').classList.toggle('hidden', tab !== 'scene' || treeView)
    $('tree-scene').classList.toggle('hidden', tab !== 'scene' || !treeView)
    $('editor-experiment').classList.toggle('hidden', treeView)
    $('tree-experiment').classList.toggle('hidden', !treeView)
    syncTrees()
  }

  const sceneEditor = makeEditor($('editor-scene'), '', 'json', (text) => {
    if (treeView && tab === 'scene') sceneTree.setText(text) // whoever changed the text, the tree follows
    if (loading) return
    saveDoc(current, docNow())
    showScene(text)
    debounce('scene', () => send({ type: 'scene', scene: text }))
  })
  const scriptEditor = makeEditor($('editor-script'), '', 'js', (text) => {
    if (loading) return
    saveDoc(current, docNow())
    debounce('script', () => send({ type: 'script', script: live(text) }))
  })
  const experimentEditor = makeEditor($('editor-experiment'), '', 'json', () => {
    syncTrees()
    if (loading) return
    saveDoc(current, docNow())
  })
  Object.assign(window, { breve: { sceneEditor, scriptEditor, worker, viewport } }) // handle for poking at it from the console

  // ---- keyboard: held keys go to controllers that ask for them (ctx.input), while the 3D view has focus ----
  const held = new Set<string>()
  const view = $('viewport')
  const sendKeys = () => send({ type: 'keys', keys: [...held] })
  view.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) return
    held.add(e.key.toLowerCase())
    sendKeys()
    if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault()
  })
  view.addEventListener('keyup', (e) => { held.delete(e.key.toLowerCase()); sendKeys() })
  view.addEventListener('blur', () => { held.clear(); sendKeys() })

  // ---- inspector: click an entity to see and edit it ----
  let inspecting: { set: number; row: number } | null = null
  const inspector = new InspectorPanel($('inspector'), {
    poke: (field, value, index) => inspecting && send({ type: 'poke', ...inspecting, field, value, index }),
    controller: (set, name) => {
      const next = setEntityKey(sceneEditor.getText(), set, 'type', name === 'default' ? undefined : name)
      if (next === null) return
      loading = true
      sceneEditor.setText(next)
      loading = false
      saveDoc(current, docNow())
      showScene(next)
      send({ type: 'scene', scene: next })
    },
    close: () => stopInspecting(),
  })
  const stopInspecting = () => {
    inspecting = null
    inspector.hide()
    viewport.view.select(null)
    send({ type: 'uninspect' })
  }
  viewport.onPick = (sel) => {
    if (!sel) return stopInspecting()
    inspecting = sel
    viewport.view.select(sel)
    send({ type: 'inspect', ...sel })
  }

  // ---- assistant ----
  const chat = new ChatPanel($('chat'), {
    project: () => ({ id: current, name: projectName(), ...docNow() }),
    apply(doc) {
      loading = true
      sceneEditor.setText(doc.scene)
      scriptEditor.setText(doc.script)
      loading = false
      saveDoc(current, { ...doc, experiment: experimentEditor.getText() })
      showScene(doc.scene)
      send({ type: 'scene', scene: doc.scene })
      send({ type: 'script', script: live(doc.script) })
    },
    scriptName: () => $('script-tab').textContent ?? 'script.js',
  })
  void chat.init()
  const docs = new DocsPanel($('docs'))

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
    // examples are listed by folder, in the order the index first mentions each
    const folders = [...new Set(examples.map((e) => e.folder ?? 'Examples'))]
    for (const f of folders) group(f, examples.filter((e) => (e.folder ?? 'Examples') === f))
    group('My projects', userProjects())
    picker.value = current
    const mine = !isExample(current)
    nameBox.classList.toggle('hidden', !mine)
    $('delete').classList.toggle('hidden', !mine)
    $('restore').classList.toggle('hidden', mine)
    if (mine) nameBox.value = userProjects().find((p) => p.id === current)?.name ?? ''
  }

  // What each example's own files were when this page opened them, so an edit can be told apart from "unchanged".
  const originals = new Map<string, { doc: Doc; hash: string }>()
  const original = async (id: string) => {
    let o = originals.get(id)
    if (!o) {
      const doc = await fetchExample(exampleById.get(id) as ExampleInfo)
      originals.set(id, (o = { doc, hash: fingerprint(doc) }))
    }
    return o
  }
  /**
   * Remember the person's edits. An example that matches its original is not stored at all (so it follows the example when
   * the example improves); an edited one is stored with a fingerprint of the original it was edited from.
   */
  const saveDoc = (id: string, doc: Doc): void => {
    const o = originals.get(id)
    if (!o) return storeDoc(id, doc)
    if (sameDoc(doc, o.doc)) return clearDoc(id)
    storeDoc(id, { ...doc, base: o.hash })
  }
  const getDoc = async (id: string): Promise<Doc | null> => {
    const ex = exampleById.get(id)
    if (!ex) return savedDoc(id)
    const o = await original(id)
    const saved = savedDoc(id)
    if (saved && saved.base === o.hash) return saved
    if (saved) {
      // The example changed since this copy was made (or the copy predates the fingerprint). Running the old copy against the new
      // engine is what used to leave a simulation stuck until "Restore example": show the current example, and keep the old edits as a project.
      clearDoc(id)
      if (!sameDoc(saved, o.doc)) {
        const copy = createProject(`${ex.name} (your older copy)`, id, { scene: saved.scene, script: saved.script, experiment: saved.experiment })
        toast(`“${ex.name}” has been updated, so it is showing the new version. Your earlier edits are saved as “${copy.name}”.`)
      }
    }
    // an untouched example follows the example itself, with only the slider values the person set
    const doc = { ...o.doc }
    for (const [name, value] of Object.entries(savedParams(id))) doc.scene = setParamInText(doc.scene, name, value) ?? doc.scene
    return doc
  }

  async function open(id: string): Promise<void> {
    const doc = await getDoc(id)
    if (!doc) return open(examples[0].id)
    current = id
    chat.setProject(id)
    loading = true
    sceneEditor.setText(doc.scene)
    scriptEditor.setText(doc.script)
    experimentEditor.setText(doc.experiment ?? defaultExperiment(doc.scene))
    loading = false
    experiment.clear()
    metrics.clear()
    if (inspecting) stopInspecting()
    if (sweeping) showSweep(false)
    showScene(doc.scene)
    renderPicker()
    history.replaceState(null, '', '#' + id)
    // relative model paths in a scene start at the example's folder (a copy of an example keeps using the original's files)
    const home = isExample(id) ? id : userProjects().find((p) => p.id === id)?.from
    unapproved = !!userProjects().find((p) => p.id === id)?.untrusted
    $('held').classList.toggle('hidden', !unapproved)
    const assets = `${location.origin}/${home && isExample(home) ? home + '/' : ''}`
    viewport.view.setAssetBase(assets)
    send({ type: 'init', scene: doc.scene, script: live(doc.script), base: assets, epoch: ++epoch })
  }

  picker.addEventListener('change', () => open(picker.value))
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== current) open(id) })

  $('fork').addEventListener('click', () => {
    const base = isExample(current) ? exampleById.get(current)!.name : userProjects().find((p) => p.id === current)?.name ?? 'Project'
    const p = createProject(`${base} copy`, current, docNow(), unapproved)
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

  // ---- experiments ----
  const status = $('status')
  const problems = $('problems')
  const showProblems = (scene: string[], script: string[], runtime: string[]) => {
    sceneTree.setErrors(scene)
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
    $('drawer-toggle').classList.toggle('has-problems', bad) // the editor may be closed: a dot says something needs a look
    $('drawer-handle').classList.toggle('has-problems', bad)
    status.textContent = bad ? 'error · last good version still running' : 'ok · live'
    status.className = 'status ' + (bad ? 'bad' : 'ok')
  }
  const experiment = new ExperimentPanel({
    texts: () => ({ scene: sceneEditor.getText(), script: live(scriptEditor.getText()), experiment: experimentEditor.getText() }),
    apply(params) {
      let next = sceneEditor.getText()
      for (const [name, value] of Object.entries(params)) next = setParamInText(next, name, value) ?? next
      loading = true
      sceneEditor.setText(next)
      loading = false
      rememberParams(params)
      showScene(next)
      send({ type: 'scene', scene: next })
    },
    watch(runs) {
      tiles.clear()
      try { tiles.setMetric(JSON.parse(sceneEditor.getText()).metrics?.[0] ?? '') } catch { tiles.setMetric('') }
      showSweep(true)
      send({ type: 'sweep', runs })
    },
    problems: (errors) => showProblems([], [], errors),
  })

  // ---- editor tabs and transport ----
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b))
      tab = b.dataset.tab ?? 'scene'
      $('editor-script').classList.toggle('hidden', b.dataset.tab !== 'script')
      $('exp').classList.toggle('hidden', b.dataset.tab !== 'experiment')
      $('chat').classList.toggle('hidden', b.dataset.tab !== 'chat')
      $('docs').classList.toggle('hidden', b.dataset.tab !== 'docs')
      if (b.dataset.tab === 'docs') void docs.show()
      showViews()
    }),
  )
  $('view-toggle').addEventListener('click', () => { treeView = !treeView; remember('breve.json', treeView ? 'tree' : 'text'); showViews() })

  // ---- the editor drawer: closed by default so the simulation has the stage; opens from the header, the edge tab or the E key ----
  const mainEl = document.querySelector('main')!
  const editorsEl = $('editors')
  const setDrawer = (open: boolean) => {
    mainEl.classList.toggle('drawer-open', open)
    editorsEl.inert = !open // the closed strip must not take focus
    $('drawer-toggle').setAttribute('aria-expanded', String(open))
    remember('breve.drawer', open ? 'open' : 'closed')
  }
  // The tab and the edge can both be dragged to pull the drawer out and resize it. Closed, a 10px strip stays on screen
  // so there is always something to grab. A drag that ends narrow closes it; the width you had is remembered.
  const PEEK = 10, MIN_OPEN = 280, SNAP_CLOSED = 140
  const maxWidth = () => window.innerWidth * 0.94
  let width = Math.max(MIN_OPEN, Math.min(Number(pref('breve.drawerW', '')) || 0, maxWidth())) || 0
  if (width) mainEl.style.setProperty('--drawer-w', `${width}px`)
  const startDrag = (el: HTMLElement, e: PointerEvent, onClick?: () => void) => {
    el.setPointerCapture(e.pointerId)
    const left = mainEl.getBoundingClientRect().left
    const startX = e.clientX
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 4) return
      if (!moved) { moved = true; mainEl.classList.add('drawer-resizing'); mainEl.classList.add('drawer-open'); editorsEl.inert = false }
      mainEl.style.setProperty('--drawer-w', `${Math.max(PEEK, Math.min(ev.clientX - left, maxWidth()))}px`)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      mainEl.classList.remove('drawer-resizing')
      if (!moved) return onClick?.()
      const w = Math.round(editorsEl.getBoundingClientRect().width)
      if (w < SNAP_CLOSED) {
        mainEl.style.setProperty('--drawer-w', `${width || Math.min(760, maxWidth())}px`) // reopening uses the last real width
        setDrawer(false)
      } else {
        width = Math.max(MIN_OPEN, w)
        mainEl.style.setProperty('--drawer-w', `${width}px`)
        remember('breve.drawerW', String(width))
        setDrawer(true)
      }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    e.preventDefault()
  }
  $('drawer-grip').addEventListener('pointerdown', (e) => startDrag($('drawer-grip'), e))
  $('drawer-handle').addEventListener('pointerdown', (e) => startDrag($('drawer-handle'), e, () => toggleDrawer()))
  const toggleDrawer = () => setDrawer(!mainEl.classList.contains('drawer-open'))
  setDrawer(pref('breve.drawer', 'closed') === 'open' || new URLSearchParams(location.search).get('tab') === 'docs')
  $('drawer-toggle').addEventListener('click', toggleDrawer)
  $('drawer-close').addEventListener('click', () => setDrawer(false))
  document.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, .cm-editor, [contenteditable]')
    if (e.key === 'Escape' && mainEl.classList.contains('drawer-open')) setDrawer(false)
    else if ((e.key === 'e' || e.key === 'E') && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) toggleDrawer()
  })
  showViews()

  if (new URLSearchParams(location.search).get('tab') === 'docs') document.querySelector<HTMLButtonElement>('[data-tab=docs]')!.click()

  // ---- transport: play and pause are icons, next to step, reset and the timeline ----
  const svg = (d: string) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">${d}</svg>`
  const ICONS = {
    play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>'),
    pause: svg('<rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/>'),
    step: svg('<path d="M6 5.5v13a1 1 0 0 0 1.5.86l8-6.5a1 1 0 0 0 0-1.72l-8-6.5A1 1 0 0 0 6 5.5z"/><rect x="17" y="5" width="2.6" height="14" rx="1.1"/>'),
    reset: svg('<path d="M12 4.5a7.5 7.5 0 1 0 7.2 9.6 1 1 0 0 0-1.9-.6A5.5 5.5 0 1 1 12 6.5c1.2 0 2.3.4 3.2 1l-1.7 1.7a.6.6 0 0 0 .4 1H19a.6.6 0 0 0 .6-.6V4.4a.6.6 0 0 0-1-.4l-1.4 1.4A7.4 7.4 0 0 0 12 4.5z"/>'),
  }
  let running = true
  const showRunning = () => {
    const b = $('play')
    b.innerHTML = running ? ICONS.pause : ICONS.play
    b.setAttribute('aria-label', running ? 'Pause' : 'Play')
    b.title = running ? 'Pause (space)' : 'Play (space)'
  }
  const setRunning = (r: boolean) => { running = r; showRunning(); send({ type: 'play', running }) }
  $('step').innerHTML = ICONS.step
  $('reset').innerHTML = ICONS.reset
  showRunning()
  $('play').addEventListener('click', () => setRunning(!running))
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey) return
    if ((e.target as HTMLElement | null)?.closest('input, textarea, select, button, .cm-editor, [contenteditable], #viewport')) return
    e.preventDefault()
    setRunning(!running)
  })
  $('sweep').addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('[data-tab=experiment]')!.click()
    $('exp-watch').click()
  })
  $('step').addEventListener('click', () => send({ type: 'step' }))
  $('reset').addEventListener('click', () => { metrics.clear(); tiles.resetHistory(); send({ type: 'reset' }) })

  // ---- timeline: drag back through the run; Play carries on from there ----
  const slider = $('timeline-slider') as HTMLInputElement
  let scrubbing = false
  let pendingSeek: number | null = null
  const sendSeek = () => {
    if (pendingSeek === null) return
    send({ type: 'seek', tick: pendingSeek })
    pendingSeek = null
    setRunning(false)
  }
  slider.addEventListener('pointerdown', () => { scrubbing = true })
  window.addEventListener('pointerup', () => { scrubbing = false })
  slider.addEventListener('input', () => { pendingSeek = Number(slider.value); requestAnimationFrame(sendSeek) })

  // ---- thinking: lockstep or realtime, and saving or replaying the decision log ----
  const thinkMode = $('think-mode') as HTMLSelectElement
  thinkMode.addEventListener('change', () => send({ type: 'thinkMode', mode: thinkMode.value as 'realtime' | 'lockstep' }))
  $('think-save').addEventListener('click', () => send({ type: 'saveLog' }))
  const thinkFile = $('think-file') as HTMLInputElement
  $('think-replay').addEventListener('click', () => thinkFile.click())
  thinkFile.addEventListener('change', async () => {
    const file = thinkFile.files?.[0]
    thinkFile.value = ''
    if (!file) return
    try {
      const log = JSON.parse(await file.text()) as unknown
      if (!Array.isArray(log) || log.some((d) => typeof d?.tick !== 'number' || typeof d?.set !== 'number' || typeof d?.row !== 'number')) throw new Error('expected a list of { tick, set, row, decision }')
      metrics.clear()
      send({ type: 'replay', log })
    } catch (e) {
      $('stats').textContent = `could not read that decision log: ${e instanceof Error ? e.message : String(e)}`
    }
  })
  const download = (name: string, text: string) => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  let lastTick = 0
  let lastTime = performance.now()
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data
    // frames still in flight from the project we just left must not draw into the new one
    if ((m.type === 'frame' || m.type === 'tiles') && m.epoch !== epoch) return
    if (m.type === 'frame') {
      $('thinkbar').classList.toggle('hidden', !m.think.enabled || sweeping)
      if (m.think.enabled) {
        thinkMode.value = m.think.mode
        $('think-count').textContent = `${m.think.decisions} decisions${m.think.replaying ? ' · replaying a log, the model is not asked' : ''}${m.think.complete ? '' : ' · the log is too long to keep from the start, so it cannot replay this run'}`
      }
      const flags = $('flags')
      flags.classList.toggle('hidden', m.nondeterministic.length === 0)
      if (m.nondeterministic.length) {
        flags.textContent = '⚠ not repeatable'
        flags.title = `${m.nondeterministic.join(', ')} depend${m.nondeterministic.length === 1 ? 's' : ''} on something outside the simulation (a person at the keyboard, a language model, or a model running on the GPU). A rerun or a fork may not match. To repeat a run exactly, save its decision log and replay it.`
      }
      $('timeline').classList.toggle('hidden', !m.timeline || sweeping)
      if (m.timeline) {
        slider.min = String(m.timeline.first); slider.max = String(m.timeline.last); slider.step = String(m.timeline.step)
        if (!scrubbing) slider.value = String(Math.min(m.tick, m.timeline.last))
        $('timeline-label').textContent = `tick ${m.tick}${m.tick < m.timeline.last ? ' · earlier than the latest' : ''}`
      }
      viewport.update(m.frames.map((f) => ({ ...f, rate: m.rate })))
      if (inspecting) { if (m.inspected) inspector.update(m.inspected); else stopInspecting() }
      if (m.metrics) metrics.push(m.metrics)
      const now = performance.now()
      if (now - lastTime > 500) {
        const tps = Math.max(0, ((m.tick - lastTick) * 1000) / (now - lastTime))
        lastTick = m.tick
        lastTime = now
        $('stats').textContent = `tick ${m.tick} · ${m.frames.map((f) => `${f.count} ${m.frames.length > 1 && f.name ? f.name : f.kind === 'lattice' ? 'live cells' : f.kind === 'bodies' ? 'creatures' : f.kind === 'graph' ? 'nodes' : 'agents'}`).join(', ')} · ${tps.toFixed(0)} ticks/s · ${m.stepMs.toFixed(1)} ms/tick`
      }
    } else if (m.type === 'crumbs') {
      // a trail like "All runs › c04": every step but the last goes back to that level
      const bar = $('crumbs')
      bar.classList.toggle('hidden', m.trail.length === 0)
      bar.replaceChildren(...m.trail.flatMap((name, i) => {
        const last = i === m.trail.length - 1
        const el = last ? Object.assign(document.createElement('span'), { className: 'crumb-here', textContent: name }) : Object.assign(document.createElement('button'), { textContent: name, title: 'Back to all the runs, where you left them', onclick: () => send({ type: 'unfocus' }) })
        return last ? [el] : [el, Object.assign(document.createElement('span'), { className: 'crumb-sep', textContent: '›' })]
      }))
    } else if (m.type === 'population') {
      // a script with a `parent` runs its own group of sims: show them as tiles (the breadcrumbs say where you are)
      showSweep(m.on)
      $('sweepbar').classList.toggle('hidden', true)
    } else if (m.type === 'tiles') {
      if (sweeping) tiles.update(m.tiles, '')
      const now = performance.now()
      if (now - lastTime > 500) {
        const tps = Math.max(0, ((m.tick - lastTick) * 1000) / (now - lastTime))
        lastTick = m.tick
        lastTime = now
        $('stats').textContent = `${m.status ? m.status + ' · ' : ''}tick ${m.tick} · ${m.tiles.length} runs · ${tps.toFixed(0)} ticks/s · ${m.stepMs.toFixed(1)} ms/tick (all runs)`
      }
    } else if (m.type === 'metrics') {
      metrics.clear()
      for (const sample of m.samples) metrics.push(sample)
    } else if (m.type === 'log') {
      download(`${projectName().replace(/[^\w-]+/g, '-')}-decisions.json`, JSON.stringify(m.log, null, 1))
    } else if (m.type === 'controllers') {
      inspector.setControllers(m.names)
    } else if (m.type === 'focused') {
      // continue from the picked tile: make its param values the scene's own, and go back to the big view
      let next = sceneEditor.getText()
      for (const [name, value] of Object.entries(m.params)) next = setParamInText(next, name, value) ?? next
      loading = true
      sceneEditor.setText(next)
      loading = false
      rememberParams(m.params)
      showScene(next)
      showSweep(false)
    } else if (m.type === 'problems') {
      showProblems(m.scene, m.script, m.runtime)
    }
  }

  // a link made by Share carries the whole project: keep it as one of your own, then open it
  const openShared = async (code: string): Promise<boolean> => {
    const doc = await decodeShare(code)
    if (!doc) return false
    const p = createProject(doc.name ?? 'Shared project', undefined, { scene: doc.scene, script: doc.script, experiment: doc.experiment }, true)
    await open(p.id)
    return true
  }
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#s=')) void openShared(location.hash.slice(3)) })

  $('held-run').addEventListener('click', () => { approveProject(current); void open(current) })
  $('held-delete').addEventListener('click', () => { const from = userProjects().find((p) => p.id === current)?.from; deleteProject(current); void open(from && isExample(from) ? from : examples[0].id) })

  $('share').addEventListener('click', async () => {
    const link = `${location.origin}/sim/#s=${await encodeShare({ name: projectName(), ...docNow() })}`
    try { await navigator.clipboard.writeText(link) } catch { window.prompt('Copy this link', link) }
    $('share').textContent = 'Link copied'
    setTimeout(() => { $('share').textContent = 'Share' }, 1500)
  })

  const start = location.hash.slice(1)
  const fromGallery = new URLSearchParams(location.search).get('fork')
  if (start.startsWith('s=') && (await openShared(start.slice(2)))) return
  if (fromGallery && (isExample(fromGallery) || userProjects().some((p) => p.id === fromGallery))) {
    // "Fork" in the gallery: open the project and copy it into one of your own
    history.replaceState(null, '', '/sim/')
    await open(fromGallery)
    $('fork').click()
    return
  }
  await open(start && (isExample(start) || userProjects().some((p) => p.id === start)) ? start : examples[0].id)
}

main()
