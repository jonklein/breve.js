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

/** One sparkline per metric the sim reports. */
export class MetricsPanel {
  private series = new Map<string, { values: number[]; canvas: HTMLCanvasElement; now: HTMLElement }>()

  constructor(private root: HTMLElement) {}

  push(metrics: Record<string, number>): void {
    for (const [name, v] of Object.entries(metrics)) {
      let s = this.series.get(name)
      if (!s) {
        const wrap = document.createElement('div')
        wrap.className = 'metric'
        const row = document.createElement('div')
        row.className = 'row'
        const title = document.createElement('span')
        title.textContent = name
        const now = document.createElement('span')
        now.className = 'mono'
        row.append(title, now)
        const canvas = document.createElement('canvas')
        canvas.width = 440
        canvas.height = 96
        wrap.append(row, canvas)
        this.root.appendChild(wrap)
        s = { values: [], canvas, now }
        this.series.set(name, s)
      }
      s.values.push(v)
      if (s.values.length > 300) s.values.shift()
      s.now.textContent = v.toFixed(3)
      this.draw(s.values, s.canvas)
    }
  }

  clear(): void {
    this.series.clear()
    this.root.replaceChildren()
  }

  private draw(values: number[], canvas: HTMLCanvasElement): void {
    const c = canvas.getContext('2d')!
    const { width: w, height: h } = canvas
    c.clearRect(0, 0, w, h)
    if (values.length < 2) return
    const lo = Math.min(0, ...values), hi = Math.max(1, ...values)
    c.strokeStyle = '#5aa9ff'
    c.lineWidth = 2
    c.beginPath()
    values.forEach((v, i) => {
      const x = (i / 299) * w, y = h - 6 - ((v - lo) / (hi - lo)) * (h - 12)
      if (i) c.lineTo(x, y)
      else c.moveTo(x, y)
    })
    c.stroke()
  }
}
