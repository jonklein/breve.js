import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseScene } from '@breve/core'

/** Syntax-check an ES module without running it. */
export function checkScript(code: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'breve-check-'))
  try {
    const file = join(dir, 'script.mjs')
    writeFileSync(file, code)
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (r.status === 0) return null
    const lines = (r.stderr || 'syntax error').split('\n').filter((l) => l.trim() && !l.includes(file) && !l.startsWith('Node.js'))
    return lines.slice(0, 4).join('\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Everything wrong with a proposed change, as sentences the model can act on. */
export function problemsWith(change: { scene?: string; script?: string }): string[] {
  const out: string[] = []
  if (change.scene !== undefined) {
    const r = parseScene(change.scene)
    if (!r.ok) out.push(...r.errors.map((e) => `scene.json: ${e}`))
  }
  if (change.script !== undefined) {
    const e = checkScript(change.script)
    if (e) out.push(`script: syntax error\n${e}`)
    else if (!/export\s+default/.test(change.script)) out.push('script: it must `export default { decide(...) { ... } }` (lattices may use update)')
  }
  return out
}
