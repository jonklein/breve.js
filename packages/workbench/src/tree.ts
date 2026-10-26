import { addAtPath, removeAtPath, setAtPath, type JsonPath } from '@breve/core'
import { defaultFor, hintsOf, schemaAt, type Schema } from './schema-hints'

const key = (p: JsonPath) => JSON.stringify(p)
const isParamRef = (v: unknown): v is string => typeof v === 'string' && /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v)
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

/** "#abc" as the "#aabbcc" a color input wants. */
const longHex = (c: string) => (c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c)

/**
 * A second view of a JSON file: a collapsible tree with a typed control for every value, drawn from the file's own
 * values and the JSON Schema (dropdowns for fixed choices, color pickers, "add field" lists, $param references).
 * It never owns the text: each edit is made on the text by the helpers in core, so the rest of the file keeps its
 * formatting, and the new text goes out through `onChange`.
 */
export class JsonTree {
  private text = ''
  private data: unknown = null
  private collapsed = new Set<string>()
  private errors = new Map<string, string[]>()
  private strays: string[] = []
  private body = el('div', 'tree-body')
  private banner = el('div', 'tree-banner hidden')

  constructor(private root: HTMLElement, private schema: Schema, private onChange: (text: string) => void) {
    root.classList.add('tree')
    root.append(this.banner, this.body)
  }

  /** Show this text. Text the tree itself just produced is skipped, so a control you are using is not rebuilt under you. */
  setText(text: string): void {
    if (text === this.text) return
    this.text = text
    try {
      this.data = JSON.parse(text)
      this.banner.classList.add('hidden')
    } catch (e) {
      this.banner.textContent = `The text is not valid JSON yet (${(e as Error).message}). Fix it in the text view; the tree shows the last good version.`
      this.banner.classList.remove('hidden')
      return
    }
    this.render()
  }

  /** Validation messages like `entities.0.count: must be >= 1`: each lands under the value it names, or the nearest one that exists. */
  setErrors(messages: string[]): void {
    this.errors.clear()
    this.strays = []
    for (const m of messages) {
      const at = m.match(/^([\w$.-]+):\s/)
      if (!at) { this.strays.push(m); continue }
      const path = at[1].split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s))
      const target = this.nearest(path)
      if (!target) { this.strays.push(m); continue }
      const k = key(target)
      this.errors.set(k, [...(this.errors.get(k) ?? []), m.slice(at[0].length)])
    }
    if (this.data !== null) this.render()
  }

  /** The longest prefix of `path` that exists in the data. */
  private nearest(path: JsonPath): JsonPath | null {
    let cur: unknown = this.data
    const out: JsonPath = []
    for (const s of path) {
      if (cur && typeof cur === 'object' && s in (cur as object)) { cur = (cur as Record<string | number, unknown>)[s]; out.push(s) } else break
    }
    return out.length || path.length === 0 ? out : null
  }

  private apply(next: string | null, rerender: boolean): void {
    if (next === null) return
    this.text = next
    this.data = JSON.parse(next)
    this.onChange(next)
    if (rerender) this.render()
  }

  private render(): void {
    this.body.replaceChildren()
    if (this.strays.length) {
      const box = el('div', 'tree-stray')
      for (const m of this.strays) box.append(el('div', 'tree-err', m))
      this.body.append(box)
    }
    this.node([], null, this.data, this.body)
  }

  private node(path: JsonPath, label: string | number | null, value: unknown, into: HTMLElement): void {
    const hints = hintsOf(schemaAt(this.schema, path))
    const container = value !== null && typeof value === 'object'
    const row = el('div', 'tree-row')
    const holder = el('div', 'tree-node')
    holder.append(row)
    const id = key(path)

    if (container) {
      const closed = this.collapsed.has(id)
      const toggle = el('button', 'tree-toggle', closed ? '▸' : '▾')
      toggle.title = closed ? 'Expand' : 'Collapse'
      toggle.addEventListener('click', () => { if (closed) this.collapsed.delete(id); else this.collapsed.add(id); this.render() })
      row.append(toggle)
    } else row.append(el('span', 'tree-toggle pad'))
    if (label !== null) row.append(el('span', typeof label === 'number' ? 'tree-key idx' : 'tree-key', String(label)))

    if (!container) row.append(this.leaf(path, value, hints))
    else {
      const arr = Array.isArray(value)
      const n = arr ? value.length : Object.keys(value as object).length
      row.append(el('span', 'tree-summary muted', arr ? `list · ${n}` : `${n} ${n === 1 ? 'field' : 'fields'}`))
    }
    row.append(el('span', 'spacer'))
    if (path.length) {
      const del = el('button', 'tree-del', '×')
      del.title = 'Remove'
      del.addEventListener('click', () => this.apply(removeAtPath(this.text, path), true))
      row.append(del)
    }
    for (const m of this.errors.get(id) ?? []) holder.append(el('div', 'tree-err', m))

    if (container && !this.collapsed.has(id)) {
      const kids = el('div', 'tree-kids')
      if (Array.isArray(value)) value.forEach((v, i) => this.node([...path, i], i, v, kids))
      else for (const [k, v] of Object.entries(value as Record<string, unknown>)) this.node([...path, k], k, v, kids)
      kids.append(this.adder(path, Array.isArray(value), value as object, hints))
      holder.append(kids)
    }
    into.append(holder)
  }

  private leaf(path: JsonPath, value: unknown, hints: ReturnType<typeof hintsOf>): HTMLElement {
    const box = el('span', 'tree-leaf')
    const set = (v: unknown) => this.apply(setAtPath(this.text, path, v), false)

    if (typeof value === 'boolean') {
      const c = el('input')
      c.type = 'checkbox'
      c.checked = value
      c.addEventListener('change', () => set(c.checked))
      box.append(c)
    } else if (typeof value === 'number') {
      const n = el('input')
      n.type = 'number'
      n.step = hints.numberRange.step ? String(hints.numberRange.step) : 'any'
      if (hints.numberRange.min !== undefined) n.min = String(hints.numberRange.min)
      if (hints.numberRange.max !== undefined) n.max = String(hints.numberRange.max)
      n.value = String(value)
      n.addEventListener('change', () => { if (n.value !== '' && Number.isFinite(Number(n.value))) set(Number(n.value)) })
      box.append(n)
      if (hints.acceptsParam) box.append(this.paramButton(path, '$', 'Use a param here instead of a number'))
    } else if (typeof value === 'string') {
      if (hints.choices && hints.choices.includes(value)) {
        const s = el('select')
        for (const c of hints.choices) s.append(Object.assign(el('option'), { value: String(c), textContent: String(c) }))
        s.value = value
        s.addEventListener('change', () => set(s.value))
        box.append(s)
      } else if (isParamRef(value) && hints.acceptsParam) {
        const names = Object.keys((this.data as { params?: object })?.params ?? {})
        const s = el('select')
        for (const nme of [...new Set([value.slice(1), ...names])]) s.append(Object.assign(el('option'), { value: '$' + nme, textContent: '$' + nme }))
        s.value = value
        s.addEventListener('change', () => set(s.value))
        const back = el('button', 'tree-mini', '#')
        back.title = 'Use a number instead'
        back.addEventListener('click', () => this.apply(setAtPath(this.text, path, 0), true))
        box.append(s, back)
      } else {
        const t = el('input')
        t.type = 'text'
        t.value = value
        t.addEventListener('change', () => set(t.value))
        box.append(t)
        if (hints.color || HEX.test(value)) {
          const c = el('input', 'tree-color')
          c.type = 'color'
          c.value = HEX.test(value) ? longHex(value) : '#000000'
          c.addEventListener('input', () => { t.value = c.value })
          c.addEventListener('change', () => set(c.value))
          box.append(c)
        } else if (hints.acceptsParam) box.append(this.paramButton(path, '$', 'Use a param here'))
      }
    } else box.append(el('span', 'muted', 'null'))
    return box
  }

  private paramButton(path: JsonPath, label: string, title: string): HTMLElement {
    const b = el('button', 'tree-mini', label)
    b.title = title
    b.addEventListener('click', () => {
      const names = Object.keys((this.data as { params?: object })?.params ?? {})
      if (!names.length) { b.title = 'The scene has no params yet'; return }
      this.apply(setAtPath(this.text, path, '$' + names[0]), true)
    })
    return b
  }

  /** The "+ add" row of a list or object: fields the schema names (and any other key you type), or a new item. */
  private adder(path: JsonPath, isList: boolean, value: object, hints: ReturnType<typeof hintsOf>): HTMLElement {
    const row = el('div', 'tree-add')
    if (isList) {
      const b = el('button', 'tree-mini wide', '+ add')
      b.addEventListener('click', () => this.apply(addAtPath(this.text, path, defaultFor(hints.child)), true))
      row.append(b)
      return row
    }
    const have = new Set(Object.keys(value))
    const open = hints.fields.filter((f) => !have.has(f))
    const pick = el('select')
    pick.append(Object.assign(el('option'), { value: '', textContent: open.length || hints.child ? '+ add…' : '+ add a field…' }))
    for (const f of open) pick.append(Object.assign(el('option'), { value: f, textContent: f }))
    pick.append(Object.assign(el('option'), { value: '\0custom', textContent: 'other name…' }))
    pick.addEventListener('change', () => {
      let name = pick.value
      pick.value = ''
      if (name === '\0custom') name = (window.prompt('Name of the new field') ?? '').trim()
      if (!name || have.has(name)) return
      const sub = schemaAt(this.schema, [...path, name])
      this.apply(addAtPath(this.text, path, defaultFor(sub ?? hints.child), name), true)
    })
    row.append(pick)
    return row
  }
}
