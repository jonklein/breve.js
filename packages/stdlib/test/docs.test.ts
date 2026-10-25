import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error plain JS script without types
import { generate } from '../../../scripts/gen-docs.mjs'

test('docs/stdlib.md is up to date with the doc comments (run `npm run docs` to refresh it)', () => {
  const onDisk = readFileSync(new URL('../../../docs/stdlib.md', import.meta.url), 'utf8')
  assert.equal(onDisk, generate())
})

test('every public thing scripts use is documented', () => {
  const md: string = generate()
  for (const name of ['Vec3', 'Vecs', 'Nums', 'Agents', 'AgentView', 'Field', 'Mlp']) assert.match(md, new RegExp(`## ${name}\\b`), `${name} is missing`)
})
