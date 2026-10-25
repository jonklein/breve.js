import type { Inspected } from '@breve/core'

type Value = number | boolean | string | number[]

/**
 * A small box over the 3D view showing the entity you clicked: its set, its controller (swap it with the
 * menu), and every field. Numbers, switches and text can be edited; arrays are shown read-only (edit
 * one slot with the number box under them).
 */
export class InspectorPanel {
  private head = document.createElement('div')
  private title = document.createElement('strong')
  private close = document.createElement('button')
  private picker = document.createElement('select')
  private table = document.createElement('div')
  private signature = ''
  private inputs = new Map<string, HTMLInputElement>()

  constructor(
    private root: HTMLElement,
    private handlers: {
      poke(field: string, value: number | boolean | string, index?: number): void
      controller(set: string, name: string): void
      close(): void
    },
  ) {
    this.root.classList.add('hidden')
    this.head.className = 'insp-head'
    this.close.textContent = '×'
    this.close.title = 'Stop inspecting'
    this.close.addEventListener('click', () => handlers.close())
    this.head.append(this.title, this.close)
    this.picker.title = 'Which controller from the script drives this set'
    this.table.className = 'insp-table'
    this.root.append(this.head, this.picker, this.table)
  }

  hide(): void {
    this.root.classList.add('hidden')
    this.signature = ''
  }

  /** The script's controller names, for the swap menu. */
  private names: string[] = []
  setControllers(names: string[]): void {
    this.names = names
    this.signature = ''
  }

  update(info: Inspected): void {
    this.root.classList.remove('hidden')
    this.title.textContent = `${info.set} · ${info.kind} #${info.row}`
    const sig = JSON.stringify([info.set, info.row, info.controller, this.names, Object.keys(info.fields)])
    if (sig !== this.signature) {
      this.signature = sig
      this.build(info)
    }
    for (const [name, v] of Object.entries(info.fields) as [string, Value][]) {
      const input = this.inputs.get(name)
      if (!input || document.activeElement === input) continue
      if (typeof v === 'boolean') input.checked = v
      else if (!Array.isArray(v)) input.value = typeof v === 'number' ? String(Number(v.toFixed(4))) : v
      else this.table.querySelector<HTMLElement>(`[data-arr="${name}"]`)!.textContent = v.map((x) => Number(x.toFixed(3))).join(', ')
    }
  }

  private build(info: Inspected): void {
    this.picker.replaceChildren(...this.names.map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n === 'default' ? 'default controller' : n })))
    this.picker.value = info.controller
    this.picker.style.display = this.names.length > 1 ? '' : 'none'
    this.picker.onchange = () => this.handlers.controller(info.set, this.picker.value)
    this.table.replaceChildren()
    this.inputs.clear()
    for (const [name, v] of Object.entries(info.fields) as [string, Value][]) {
      const label = document.createElement('label')
      label.textContent = name
      const input = document.createElement('input')
      if (Array.isArray(v)) {
        const text = document.createElement('span')
        text.dataset.arr = name
        text.className = 'mono insp-arr'
        const slot = document.createElement('input')
        slot.type = 'number'; slot.step = 'any'; slot.placeholder = 'slot'; slot.className = 'insp-slot'
        const value = document.createElement('input')
        value.type = 'number'; value.step = 'any'; value.placeholder = 'new value'
        value.addEventListener('change', () => this.handlers.poke(name, Number(value.value), Number(slot.value || 0)))
        label.append(text, slot, value)
      } else {
        if (typeof v === 'boolean') {
          input.type = 'checkbox'
          input.addEventListener('change', () => this.handlers.poke(name, input.checked))
        } else if (typeof v === 'number') {
          input.type = 'number'; input.step = 'any'
          input.addEventListener('change', () => this.handlers.poke(name, Number(input.value)))
        } else {
          input.type = 'text'
          input.addEventListener('change', () => this.handlers.poke(name, input.value))
        }
        this.inputs.set(name, input)
        label.append(input)
      }
      this.table.appendChild(label)
    }
  }
}
