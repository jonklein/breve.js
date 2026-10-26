import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setAtPath, removeAtPath, addAtPath, formatInline } from '../src/index'

const text = `{
  "seed": 1,
  "bounds": { "size": 20, "mode": "clamp" },
  "params": {
    "count": { "value": 70, "min": 5 },
    "speed": 5
  },
  "entities": [
    { "name": "ants", "count": "$count", "color": "#f2d088" },
    { "name": "ground", "lattice": { "size": [1, 2, 3] } }
  ],
  "metrics": ["a", "b"]
}`

const same = (a: string | null) => { assert.ok(a !== null); JSON.parse(a!); return a! }

test('setAtPath replaces one value and leaves every other byte alone', () => {
  assert.equal(same(setAtPath(text, ['seed'], 7)), text.replace('"seed": 1', '"seed": 7'))
  assert.equal(same(setAtPath(text, ['entities', 0, 'color'], '#fff')), text.replace('#f2d088', '#fff'))
  assert.equal(same(setAtPath(text, ['entities', 1, 'lattice', 'size', 2], 9)), text.replace('[1, 2, 3]', '[1, 2, 9]'))
  assert.equal(same(setAtPath(text, ['bounds'], { size: 5 })), text.replace('{ "size": 20, "mode": "clamp" }', '{ "size": 5 }'))
  assert.equal(setAtPath(text, ['nope'], 1), null)
  assert.equal(setAtPath(text, ['entities', 5], 1), null)
})

test('removeAtPath takes a member or element with its comma, first, middle or last', () => {
  assert.equal(same(removeAtPath(text, ['seed'])), text.replace('  "seed": 1,\n', ''))
  assert.equal(same(removeAtPath(text, ['bounds', 'mode'])), text.replace('{ "size": 20, "mode": "clamp" }', '{ "size": 20 }'))
  assert.equal(same(removeAtPath(text, ['metrics', 1])), text.replace('["a", "b"]', '["a"]'))
  assert.equal(same(removeAtPath(text, ['metrics', 0])), text.replace('["a", "b"]', '["b"]'))
  const mid = same(removeAtPath(text, ['entities', 0]))
  assert.equal(JSON.parse(mid).entities.length, 1)
  assert.equal(same(removeAtPath(text, ['params', 'speed'])), text.replace(',\n    "speed": 5', ''))
  assert.equal(same(removeAtPath('{ "a": [1] }', ['a', 0])), '{ "a": [] }')
  assert.equal(same(removeAtPath('{ "a": 1 }', ['a'])), '{}')
  assert.equal(removeAtPath(text, []), null)
})

test('addAtPath puts a new entry on its own line when the others are, inline when they are', () => {
  const a = same(addAtPath(text, ['params'], 3, 'extra'))
  assert.ok(a.includes('"speed": 5,\n    "extra": 3\n  }'), a)
  const b = same(addAtPath(text, ['bounds'], false, 'wrap'))
  assert.ok(b.includes('{ "size": 20, "mode": "clamp", "wrap": false }'), b)
  const c = same(addAtPath(text, ['metrics'], 'c'))
  assert.ok(c.includes('["a", "b", "c"]'))
  const d = same(addAtPath(text, ['entities'], { name: 'x' }))
  assert.ok(d.includes('"lattice": { "size": [1, 2, 3] } },\n    { "name": "x" }\n  ]'), d)
  assert.equal(same(addAtPath('{}', [], 1, 'a')), '{ "a": 1 }')
  assert.equal(same(addAtPath('{ "a": [] }', ['a'], 1)), '{ "a": [1] }')
  assert.equal(addAtPath(text, ['bounds'], 1, 'size'), null, 'an existing key is not added twice')
  assert.equal(addAtPath(text, ['seed'], 1, 'x'), null, 'a number is not a container')
})

test('formatInline matches the example files\' style', () => {
  assert.equal(formatInline({ a: 1, b: [1, 2], c: {}, d: { e: 'x' } }), '{ "a": 1, "b": [1, 2], "c": {}, "d": { "e": "x" } }')
  assert.equal(formatInline([]), '[]')
})
