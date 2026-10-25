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
