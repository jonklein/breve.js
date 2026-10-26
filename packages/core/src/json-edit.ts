import { elements, members, skip, valueEnd, type Span } from './text-edit'

/** Where a value sits in a document: keys for objects, indexes for arrays. */
export type JsonPath = (string | number)[]

/** JSON on one line in the style the example files use: `{ "a": 1, "b": [1, 2] }`. */
export function formatInline(v: unknown): string {
  if (Array.isArray(v)) return v.length ? `[${v.map(formatInline).join(', ')}]` : '[]'
  if (v && typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
    return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${formatInline(x)}`).join(', ')} }` : '{}'
  }
  return JSON.stringify(v) ?? 'null'
}

interface Found { value: Span; /** The whole `"key": value` of an object member, or the element of an array. */ whole: Span; siblings: Span[]; index: number; parent: 'object' | 'array' | 'root' }

function find(text: string, path: JsonPath): Found | null {
  let start = skip(text, 0)
  let cur: Found = { value: { start, end: valueEnd(text, start) }, whole: { start, end: valueEnd(text, start) }, siblings: [], index: 0, parent: 'root' }
  for (const step of path) {
    const at = cur.value.start
    if (typeof step === 'string') {
      if (text[at] !== '{') return null
      const ms = members(text, at)
      const index = ms.findIndex((m) => m.key === step)
      if (index < 0) return null
      cur = { value: ms[index].value, whole: ms[index].whole, siblings: ms.map((m) => m.whole), index, parent: 'object' }
    } else {
      if (text[at] !== '[') return null
      const els = elements(text, at)
      if (step < 0 || step >= els.length) return null
      cur = { value: els[step], whole: els[step], siblings: els, index: step, parent: 'array' }
    }
  }
  return cur
}

/** Replace the value at `path`; everything else in the text stays as written. Null if the path is not there. */
export function setAtPath(text: string, path: JsonPath, value: unknown): string | null {
  const f = find(text, path)
  return f ? text.slice(0, f.value.start) + formatInline(value) + text.slice(f.value.end) : null
}

/** Remove the member or element at `path`, with its comma. Null if the path is not there or is the root. */
export function removeAtPath(text: string, path: JsonPath): string | null {
  const f = find(text, path)
  if (!f || f.parent === 'root') return null
  const { siblings, index } = f
  if (siblings.length === 1) {
    // the last one: leave an empty container, closed on the same line
    const open = path.length ? find(text, path.slice(0, -1))! : null
    const a = open!.value.start
    return text.slice(0, a + 1) + text.slice(valueEnd(text, a) - 1)
  }
  if (index < siblings.length - 1) return text.slice(0, f.whole.start) + text.slice(siblings[index + 1].start) // up to where the next one starts
  return text.slice(0, siblings[index - 1].end) + text.slice(f.whole.end) // the last: from the previous one's end, taking its comma
}

/**
 * Add `value` to the object or array at `container`: under `key` for an object, at the end for an array.
 * The new entry goes on its own line when the others do, on the same line when they are inline. Null if it cannot be added
 * (not there, not a container, or the key exists).
 */
export function addAtPath(text: string, container: JsonPath, value: unknown, key?: string): string | null {
  const f = find(text, container)
  if (!f) return null
  const open = f.value.start
  const isObj = text[open] === '{', isArr = text[open] === '['
  if (!isObj && !isArr) return null
  if (isObj && key === undefined) return null
  const entry = isObj ? `${JSON.stringify(key)}: ${formatInline(value)}` : formatInline(value)
  const items = isObj ? members(text, open).map((m) => m.whole) : elements(text, open)
  if (isObj && members(text, open).some((m) => m.key === key)) return null
  const close = f.value.end - 1
  if (!items.length) return text.slice(0, open + 1) + (isObj ? ` ${entry} ` : entry) + text.slice(close)
  const last = items[items.length - 1]
  const between = text.slice(open + 1, items[0].start)
  if (between.includes('\n')) {
    // each on its own line: copy the indentation of the last entry's line
    const lineStart = text.lastIndexOf('\n', last.start) + 1
    const indent = text.slice(lineStart, last.start).match(/^\s*/)![0]
    return text.slice(0, last.end) + `,\n${indent}${entry}` + text.slice(last.end)
  }
  return text.slice(0, last.end) + `, ${entry}` + text.slice(last.end)
}
