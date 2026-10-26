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
    else if (!/export\s+(default|const\s+\w+\s*=\s*\{)/.test(change.script)) out.push('script: it must export a controller: `export default { act(...) { ... } }` or named ones like `export const Ant = { act() {} }`')
  }
  return out
}

export interface DecideRequest { prompt: string; json: boolean; images: string[] }

const MAX_IMAGES = 4
const MAX_IMAGE_CHARS = 400_000 // about 300 KB of PNG as base64 (four fit in the 2 MB request limit); a camera sensor makes a few kilobytes

/** Check the body of a `/api/decide` call: a prompt, whether to answer in JSON, and optional base64 PNG pictures. */
export function parseDecide(body: unknown): DecideRequest | { error: string } {
  const b = (body ?? {}) as { prompt?: unknown; json?: unknown; images?: unknown }
  if (typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 20000) return { error: 'expected { prompt: string, json?: boolean, images?: string[] }' }
  const images = b.images === undefined ? [] : b.images
  if (!Array.isArray(images) || images.length > MAX_IMAGES) return { error: `"images" must be a list of at most ${MAX_IMAGES} base64 PNG strings` }
  for (const img of images) {
    if (typeof img !== 'string' || img.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(img)) return { error: '"images" must hold plain base64 text (no "data:" prefix), each under about 300 KB' }
    if (!img.startsWith('iVBORw0KGgo')) return { error: '"images" must be PNG files' }
  }
  return { prompt: b.prompt, json: b.json === true, images: images as string[] }
}
