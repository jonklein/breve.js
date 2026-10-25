export interface DiffLine {
  kind: ' ' | '+' | '-'
  text: string
}

/** Line-based diff (longest common subsequence). Fine for files of a few hundred lines. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length, m = b.length
  if (n * m > 4_000_000) return [...a.map((text) => ({ kind: '-' as const, text })), ...b.map((text) => ({ kind: '+' as const, text }))]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: ' ', text: a[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: '-', text: a[i++] })
    else out.push({ kind: '+', text: b[j++] })
  }
  while (i < n) out.push({ kind: '-', text: a[i++] })
  while (j < m) out.push({ kind: '+', text: b[j++] })
  return out
}

export function diffStats(d: DiffLine[]): { added: number; removed: number } {
  return { added: d.filter((l) => l.kind === '+').length, removed: d.filter((l) => l.kind === '-').length }
}

/** The changed lines with a little context around them; unchanged stretches collapse to "…". */
export function renderDiff(d: DiffLine[], context = 2): HTMLElement {
  const keep = new Array<boolean>(d.length).fill(false)
  d.forEach((l, i) => {
    if (l.kind !== ' ') for (let k = Math.max(0, i - context); k <= Math.min(d.length - 1, i + context); k++) keep[k] = true
  })
  const pre = document.createElement('pre')
  pre.className = 'diff'
  let skipped = false
  d.forEach((l, i) => {
    if (!keep[i]) { skipped = true; return }
    if (skipped) { pre.append(row(' ', '…', 'gap')); skipped = false }
    pre.append(row(l.kind, l.text, l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : 'ctx'))
  })
  return pre
}

function row(sign: string, text: string, cls: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'dl ' + cls
  el.textContent = `${sign} ${text}`
  return el
}
