interface ParamView {
  value: number
  min: number
  max: number
  step: number
  label: string
}

function decimals(step: number): number {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1].length : 0
}

/** Sliders generated from the `params` block of the scene. */
export class ParamsPanel {
  private signature = ''
  private inputs = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement; step: number }>()

  constructor(private root: HTMLElement, private onInput: (name: string, value: number) => void) {}

  render(rawParams: unknown): void {
    if (!rawParams || typeof rawParams !== 'object') return
    const defs: [string, ParamView][] = []
    for (const [name, v] of Object.entries(rawParams as Record<string, unknown>)) {
      if (typeof v === 'number') {
        defs.push([name, { value: v, min: Math.min(0, v * 2), max: Math.max(1, v * 2), step: Math.abs(v) >= 10 ? 1 : 0.05, label: name }])
      } else if (v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'number') {
        const o = v as Partial<ParamView>
        const value = o.value as number
        defs.push([name, {
          value,
          min: o.min ?? Math.min(0, value * 2),
          max: o.max ?? Math.max(1, value * 2),
          step: o.step ?? 0.05,
          label: o.label ?? name,
        }])
      }
    }
    const sig = JSON.stringify(defs.map(([n, d]) => [n, d.min, d.max, d.step, d.label]))
    if (sig !== this.signature) {
      this.signature = sig
      this.build(defs)
    } else {
      for (const [name, d] of defs) {
        const r = this.inputs.get(name)
        if (!r) continue
        if (document.activeElement !== r.input) r.input.value = String(d.value)
        r.out.textContent = d.value.toFixed(decimals(r.step))
      }
    }
  }

  private build(defs: [string, ParamView][]): void {
    this.root.replaceChildren()
    this.inputs.clear()
    for (const [name, d] of defs) {
      const wrap = document.createElement('div')
      wrap.className = 'param'
      const label = document.createElement('label')
      label.textContent = d.label
      const out = document.createElement('output')
      out.textContent = d.value.toFixed(decimals(d.step))
      const input = document.createElement('input')
      input.type = 'range'
      input.min = String(d.min)
      input.max = String(d.max)
      input.step = String(d.step)
      input.value = String(d.value)
      input.setAttribute('aria-label', d.label)
      input.addEventListener('input', () => {
        const v = Number(input.value)
        out.textContent = v.toFixed(decimals(d.step))
        this.onInput(name, v)
      })
      wrap.append(label, out, input)
      this.root.appendChild(wrap)
      this.inputs.set(name, { input, out, step: d.step })
    }
  }
}

const LINE_COLORS = ['#5aa9ff', '#ff6b6b', '#7bd88f', '#ffd24d', '#c792ea', '#ffa657']

interface Chart {
  title: string
  names: string[]
  values: Map<string, number[]>
  canvas: HTMLCanvasElement
  legend: Map<string, HTMLElement>
}

/**
 * Line charts for the metrics the sim reports. Each metric gets its own chart, unless the scene's `charts`
 * puts several on one (sharing a scale, with a legend).
 */
export class MetricsPanel {
  private charts = new Map<string, Chart>()
  private groups: { title?: string; metrics: string[] }[] = []

  constructor(private root: HTMLElement) {}

  /** Tell the panel how the scene groups metrics; takes effect for charts made from now on. */
  setGroups(groups: { title?: string; metrics: string[] }[] | undefined): void {
    const next = groups ?? []
    if (JSON.stringify(next) === JSON.stringify(this.groups)) return
    this.groups = next
    this.clear()
  }

  private chartFor(metric: string): Chart {
    const group = this.groups.find((g) => g.metrics.includes(metric))
    const key = group ? `group:${this.groups.indexOf(group)}` : `metric:${metric}`
    let c = this.charts.get(key)
    if (c) return c
    const wrap = document.createElement('div')
    wrap.className = 'metric'
    const row = document.createElement('div')
    row.className = 'row'
    const title = document.createElement('span')
    title.textContent = group?.title ?? metric
    const legendBox = document.createElement('span')
    legendBox.className = 'mono legend'
    row.append(title, legendBox)
    const canvas = document.createElement('canvas')
    canvas.width = 440
    canvas.height = 96
    wrap.append(row, canvas)
    this.root.appendChild(wrap)
    c = { title: group?.title ?? metric, names: group ? group.metrics : [metric], values: new Map(), canvas, legend: new Map() }
    c.names.forEach((n, i) => {
      const item = document.createElement('span')
      item.style.color = LINE_COLORS[i % LINE_COLORS.length]
      item.style.marginLeft = '10px'
      legendBox.appendChild(item)
      c!.legend.set(n, item)
    })
    this.charts.set(key, c)
    return c
  }

  push(metrics: Record<string, number>): void {
    const touched = new Set<Chart>()
    for (const [name, v] of Object.entries(metrics)) {
      const c = this.chartFor(name)
      const list = c.values.get(name) ?? []
      list.push(v)
      if (list.length > 300) list.shift()
      c.values.set(name, list)
      const item = c.legend.get(name)
      if (item) item.textContent = `${c.names.length > 1 ? name + ' ' : ''}${Number.isInteger(v) ? v : v.toFixed(3)}`
      touched.add(c)
    }
    for (const c of touched) this.draw(c)
  }

  clear(): void {
    this.charts.clear()
    this.root.replaceChildren()
  }

  private draw(chart: Chart): void {
    const c = chart.canvas.getContext('2d')!
    const { width: w, height: h } = chart.canvas
    c.clearRect(0, 0, w, h)
    const all = [...chart.values.values()].flat()
    if (all.length < 2) return
    const lo = Math.min(0, ...all), hi = Math.max(1, ...all)
    c.lineWidth = 2
    chart.names.forEach((name, k) => {
      const values = chart.values.get(name) ?? []
      if (values.length < 2) return
      c.strokeStyle = LINE_COLORS[k % LINE_COLORS.length]
      c.beginPath()
      values.forEach((v, i) => {
        const x = (i / 299) * w, y = h - 6 - ((v - lo) / (hi - lo)) * (h - 12)
        if (i) c.lineTo(x, y)
        else c.moveTo(x, y)
      })
      c.stroke()
    })
  }
}
