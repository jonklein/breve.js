/**
 * Small, careful edits to scene.json text that keep the rest of the file exactly as the person wrote it
 * (comments aside, which JSON does not have), so the editor does not jump when a control changes a value.
 */

interface Span { start: number; end: number }

/** The end (exclusive) of the JSON value that starts at `i`. */
function valueEnd(text: string, i: number): number {
  const c = text[i]
  if (c === '"') {
    let j = i + 1
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
    return j + 1
  }
  if (c === '{' || c === '[') {
    let depth = 0
    for (let j = i; j < text.length; j++) {
      const d = text[j]
      if (d === '"') { j = valueEnd(text, j) - 1; continue }
      if (d === '{' || d === '[') depth++
      else if (d === '}' || d === ']') { depth--; if (depth === 0) return j + 1 }
    }
    return text.length
  }
  let j = i
  while (j < text.length && !/[,}\]\s]/.test(text[j])) j++
  return j
}

const skip = (text: string, i: number) => { while (i < text.length && /\s/.test(text[i])) i++; return i }

/** Every member of the object that starts at `start`: its key, and where the whole `"key": value` and the value sit. */
function members(text: string, start: number): { key: string; whole: Span; value: Span }[] {
  const out: { key: string; whole: Span; value: Span }[] = []
  let i = skip(text, start + 1)
  while (i < text.length && text[i] === '"') {
    const keyEnd = valueEnd(text, i)
    const key = JSON.parse(text.slice(i, keyEnd)) as string
    let v = skip(text, keyEnd)
    if (text[v] !== ':') break
    v = skip(text, v + 1)
    const ve = valueEnd(text, v)
    out.push({ key, whole: { start: i, end: ve }, value: { start: v, end: ve } })
    i = skip(text, ve)
    if (text[i] === ',') i = skip(text, i + 1)
  }
  return out
}

/** The object spans inside the array that starts at `start`. */
function elements(text: string, start: number): Span[] {
  const out: Span[] = []
  let i = skip(text, start + 1)
  while (i < text.length && text[i] !== ']') {
    const end = valueEnd(text, i)
    out.push({ start: i, end })
    i = skip(text, end)
    if (text[i] === ',') i = skip(text, i + 1)
  }
  return out
}

/**
 * Set (or, with `undefined`, remove) one top-level key of the entity set called `setName`. Returns the new text,
 * or null when the text is not scene JSON with such a set.
 */
export function setEntityKey(text: string, setName: string, key: string, value: unknown): string | null {
  let root: ReturnType<typeof members>
  try {
    JSON.parse(text)
    root = members(text, skip(text, 0))
  } catch {
    return null
  }
  const list = root.find((m) => m.key === 'entities')
  if (!list || text[list.value.start] !== '[') return null
  for (const el of elements(text, list.value.start)) {
    if (text[el.start] !== '{') continue
    const ms = members(text, el.start)
    if (JSON.parse(text.slice(ms.find((m) => m.key === 'name')!.value.start, ms.find((m) => m.key === 'name')!.value.end)) !== setName) continue
    const cur = ms.find((m) => m.key === key)
    if (cur && value !== undefined) return text.slice(0, cur.value.start) + JSON.stringify(value) + text.slice(cur.value.end)
    if (cur) {
      // remove the member and one neighboring comma
      let a = cur.whole.start, b = cur.whole.end
      const after = skip(text, b)
      if (text[after] === ',') b = skip(text, after + 1)
      else { let before = a - 1; while (before >= 0 && /\s/.test(text[before])) before--; if (text[before] === ',') a = before }
      return text.slice(0, a) + text.slice(b)
    }
    if (value === undefined) return text
    const name = ms.find((m) => m.key === 'name')!
    return text.slice(0, name.whole.end) + `, ${JSON.stringify(key)}: ${JSON.stringify(value)}` + text.slice(name.whole.end)
  }
  return null
}
