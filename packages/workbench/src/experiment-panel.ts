import { parseScene } from '@breve/core'
import { parseExperiment, sampleCandidates, toCsv, type ExperimentResult, type Trial } from '@breve/experiment'
import type { FromExperiment, ToExperiment } from './experiment.worker'

const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

/** An experiment.json to start from, built from what the scene offers: its first metric, and its first params that have a range. */
export function defaultExperiment(sceneText: string): string {
  let scene: { params?: Record<string, unknown>; metrics?: string[] } = {}
  try { scene = JSON.parse(sceneText) } catch { /* the scene is mid-edit: use bare defaults */ }
  const ranged = Object.entries(scene.params ?? {})
    .filter(([k, v]) => k !== 'count' && v && typeof v === 'object' && 'min' in (v as object) && 'max' in (v as object))
    .map(([k]) => k)
    .slice(0, 2)
  return JSON.stringify({
    name: 'try some values',
    strategy: { type: 'grid', steps: 4 },
    space: ranged.length ? ranged : ['param name'],
    objective: { metric: scene.metrics?.[0] ?? 'metric name', goal: 'max' },
    ticks: 300,
  }, null, 2) + '\n'
}

/**
 * The experiment tab: run the experiment in its own worker (so the live view stays smooth), fill a ranked table
 * as results arrive, then apply the best params, export the table, or watch the candidates side by side.
 */
export class ExperimentPanel {
  private worker = new Worker(new URL('./experiment.worker.ts', import.meta.url), { type: 'module' })
  private trials: Trial[] = []
  private result: ExperimentResult | null = null
  private total = 0
  private running = false

  constructor(private h: {
    texts(): { scene: string; script: string; experiment: string }
    apply(params: Record<string, number>): void
    watch(runs: { name: string; params: Record<string, number> }[]): void
    problems(errors: string[]): void
  }) {
    this.worker.onmessage = (ev: MessageEvent<FromExperiment>) => this.onMessage(ev.data)
    q('exp-run').addEventListener('click', () => this.run())
    q('exp-stop').addEventListener('click', () => this.worker.postMessage({ type: 'stop' } satisfies ToExperiment))
    q('exp-apply').addEventListener('click', () => { const b = this.best(); if (b) h.apply(b.params) })
    q('exp-csv').addEventListener('click', () => this.download())
    q('exp-watch').addEventListener('click', () => this.watch())
  }

  clear(): void {
    this.trials = []
    this.result = null
    this.total = 0
    q('exp-results').replaceChildren()
    q('exp-status').textContent = ''
    this.buttons()
  }

  private best(): Trial | null {
    return [...this.trials].sort((a, b) => b.score - a.score)[0] ?? null
  }

  private buttons(): void {
    q<HTMLButtonElement>('exp-run').disabled = this.running
    q<HTMLButtonElement>('exp-watch').disabled = this.running
    q<HTMLButtonElement>('exp-stop').disabled = !this.running
    q<HTMLButtonElement>('exp-apply').disabled = this.running || !this.trials.length
    q<HTMLButtonElement>('exp-csv').disabled = this.running || !this.trials.length
  }

  private run(): void {
    this.clear()
    this.running = true
    this.buttons()
    q('exp-status').textContent = 'starting…'
    this.worker.postMessage({ type: 'run', ...this.h.texts() } satisfies ToExperiment)
  }

  private watch(): void {
    const t = this.h.texts()
    const scene = parseScene(t.scene)
    if (!scene.ok) return this.h.problems(scene.errors.map((e) => `scene.json: ${e}`))
    const spec = parseExperiment(t.experiment, scene.scene)
    if (!spec.ok) return this.h.problems(spec.errors.map((e) => `experiment.json: ${e}`))
    try {
      this.h.watch(sampleCandidates(spec.spec, scene.scene, 12))
    } catch (e) {
      this.h.problems([`experiment.json: ${e instanceof Error ? e.message : String(e)}`])
    }
  }

  private onMessage(m: FromExperiment): void {
    if (m.type === 'started') {
      this.total = m.total
      this.h.problems([])
    } else if (m.type === 'trial') {
      this.trials.push(m.trial)
      q('exp-status').textContent = `${m.done} of ${this.total} runs`
      this.render()
    } else if (m.type === 'done') {
      this.running = false
      this.result = m.result
      q('exp-status').textContent = `${m.stopped ? 'stopped' : 'done'}: ${m.result.trials.length} runs`
      this.render()
      this.buttons()
    } else {
      this.running = false
      q('exp-status').textContent = 'could not run'
      this.h.problems(m.errors)
      this.buttons()
    }
  }

  private render(): void {
    const ranked = [...this.trials].sort((a, b) => b.score - a.score)
    const names = ranked[0] ? Object.keys(ranked[0].params) : []
    const metric = this.result?.spec.objective.metric ?? 'value'
    const table = document.createElement('table')
    const head = table.createTHead().insertRow()
    for (const t of ['#', ...names, metric]) head.appendChild(Object.assign(document.createElement('th'), { textContent: t }))
    const body = table.createTBody()
    ranked.slice(0, 200).forEach((t, i) => {
      const row = body.insertRow()
      if (i === 0) row.className = 'best'
      for (const c of [String(i + 1), ...names.map((n) => String(t.params[n])), Number.isFinite(t.value) ? t.value.toFixed(4) : 'n/a']) row.insertCell().textContent = c
      row.title = 'Double-click to put these params in scene.json'
      row.addEventListener('dblclick', () => this.h.apply(t.params))
    })
    q('exp-results').replaceChildren(table)
  }

  private download(): void {
    const result = this.result ?? (this.trials.length ? this.partial() : null)
    if (!result) return
    const blob = new Blob([toCsv(result)], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'experiment.csv' })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  private partial(): ExperimentResult {
    const parsed = parseExperiment(this.h.texts().experiment)
    const ranked = [...this.trials].sort((a, b) => b.score - a.score)
    return { spec: parsed.ok ? parsed.spec : ({ objective: { metric: 'value' } } as never), trials: this.trials, ranked, best: ranked[0] ?? null }
  }
}
