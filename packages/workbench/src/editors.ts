import { EditorView, basicSetup } from 'codemirror'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

export interface Editor {
  view: EditorView
  getText(): string
  /** Replace the document, touching only the span that actually changed so the cursor stays put. */
  setText(text: string): void
}

export function makeEditor(parent: HTMLElement, doc: string, lang: 'json' | 'js', onChange: (text: string) => void): Editor {
  const view = new EditorView({
    parent,
    doc,
    extensions: [
      basicSetup,
      lang === 'json' ? json() : javascript(),
      oneDark,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString())
      }),
    ],
  })
  return {
    view,
    getText: () => view.state.doc.toString(),
    setText(text) {
      const old = view.state.doc.toString()
      if (old === text) return
      let a = 0
      while (a < old.length && a < text.length && old[a] === text[a]) a++
      let b = 0
      while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++
      view.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) } })
    },
  }
}

/**
 * Set the field at a dotted path (`entities.0.network.layout`) in scene.json text. A string that appears once as
 * `"key": "old"` is swapped in place so the file keeps its formatting; anything else rewrites the file.
 */
export function setPathInText(text: string, path: string, value: string | number | boolean): string | null {
  let doc: Record<string, unknown>
  try { doc = JSON.parse(text) } catch { return null }
  const keys = path.split('.')
  let node = doc as unknown
  for (const k of keys.slice(0, -1)) {
    if (!node || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[k]
  }
  const last = keys[keys.length - 1]
  if (!node || typeof node !== 'object') return null
  const holder = node as Record<string, unknown>
  const old = holder[last]
  if (old === value) return text
  if (typeof old === 'string' && typeof value === 'string') {
    const re = new RegExp(`("${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*)${JSON.stringify(old).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')
    if ((text.match(re) ?? []).length === 1) return text.replace(re, (_m, pre) => pre + JSON.stringify(value))
  }
  holder[last] = value
  return JSON.stringify(doc, null, 2) + '\n'
}

/** The value at a dotted path in a parsed scene (undefined when the path leads nowhere). */
export function getPath(doc: unknown, path: string): unknown {
  let node = doc
  for (const k of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[k]
  }
  return node
}

/** Set one param's value in scene.json text without reformatting the rest of the file. */
export function setParamInText(text: string, name: string, value: number): string | null {
  const start = text.indexOf('"params"')
  if (start < 0) return null
  const num = '(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)'
  const key = `"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`
  const head = text.slice(0, start)
  const rest = text.slice(start)
  const objForm = new RegExp(`(${key}\\s*:\\s*\\{[^}]*?"value"\\s*:\\s*)${num}`)
  const numForm = new RegExp(`(${key}\\s*:\\s*)${num}`)
  const re = objForm.test(rest) ? objForm : numForm.test(rest) ? numForm : null
  if (!re) return null
  return head + rest.replace(re, (_m, pre) => pre + String(value))
}
