import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setEntityKey } from '../src/index'

const text = `{
  "seed": 1,
  "params": {},
  "entities": [
    { "name": "ants", "type": "Ant", "count": 5,
      "state": { "type": "x" } },
    { "name": "ground", "lattice": { "size": [1, 1, 1] } }
  ]
}`

test('setEntityKey replaces, adds and removes a key of one set, touching nothing else', () => {
  const a = setEntityKey(text, 'ants', 'type', 'Scout')!
  assert.equal(a, text.replace('"Ant"', '"Scout"'))
  const b = setEntityKey(text, 'ground', 'type', 'Ground')!
  assert.ok(b.includes('{ "name": "ground", "type": "Ground", "lattice"'))
  JSON.parse(b)
  const c = setEntityKey(text, 'ants', 'type', undefined)!
  JSON.parse(c)
  assert.ok(!c.includes('"Ant"') && c.includes('"count": 5'))
  assert.equal(JSON.parse(c).entities[0].state.type, 'x', 'a nested "type" is not touched')
  assert.equal(setEntityKey(text, 'nobody', 'type', 'x'), null)
  assert.equal(setEntityKey('{ not json', 'ants', 'type', 'x'), null)
})
