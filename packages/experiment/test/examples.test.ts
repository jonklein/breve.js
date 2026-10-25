import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseScene } from '@breve/core'
import { parseExperiment } from '../src/index'

const index = JSON.parse(readFileSync(new URL('../../../examples/index.json', import.meta.url), 'utf8')) as { id: string; scene: string; experiment?: string }[]

test('every example experiment.json is valid for its scene', () => {
  const withExperiments = index.filter((e) => e.experiment)
  assert.ok(withExperiments.length >= 3)
  for (const e of withExperiments) {
    const dir = new URL(`../../../examples/${e.id}/`, import.meta.url)
    const scene = parseScene(readFileSync(new URL(e.scene, dir), 'utf8'))
    assert.ok(scene.ok, e.id)
    const r = parseExperiment(readFileSync(new URL(e.experiment!, dir), 'utf8'), scene.ok ? scene.scene : undefined)
    assert.ok(r.ok, `${e.id}: ${r.ok ? '' : r.errors.join('; ')}`)
  }
})
