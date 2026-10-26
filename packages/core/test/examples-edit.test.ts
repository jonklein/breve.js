import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { parseScene, setAtPath, removeAtPath, addAtPath, type JsonPath } from '../src/index'

const root = new URL('../../../examples/', import.meta.url)
const examples = JSON.parse(readFileSync(new URL('index.json', root), 'utf8')) as { id: string; scene: string; experiment?: string }[]

/** Every value in a document with the path to it: what the tree editor draws a control for. */
function* walk(v: unknown, path: JsonPath = []): Generator<{ path: JsonPath; value: unknown }> {
  yield { path, value: v }
  if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* walk(v[i], [...path, i])
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) yield* walk(x, [...path, k])
}

const files = examples.flatMap((e) => [e.scene, e.experiment].filter((f): f is string => !!f).map((f) => ({ id: e.id, file: f, path: new URL(`${e.id}/${f}`, root) }))).filter((f) => existsSync(f.path))

test('every value in every example config can be changed, removed and added back from a path, and the text stays valid', () => {
  let edits = 0
  for (const f of files) {
    const text = readFileSync(f.path, 'utf8')
    const data = JSON.parse(text)
    for (const { path, value } of walk(data)) {
      const where = `${f.id}/${f.file} ${JSON.stringify(path)}`
      // set: the same value back, then a different one of the same kind
      const same = setAtPath(text, path, value)
      assert.ok(same !== null, `set ${where}`)
      assert.deepEqual(JSON.parse(same!), data, `identity set ${where}`)
      if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
        const next = typeof value === 'number' ? value + 1 : typeof value === 'boolean' ? !value : value + 'x'
        const changed = JSON.parse(setAtPath(text, path, next)!)
        let cur: any = changed
        for (const s of path) cur = cur[s]
        assert.equal(cur, next, `change ${where}`)
      }
      if (!path.length) continue
      // remove, then add back at the same place (objects by key, lists at the end): the data comes back whole
      const removed = removeAtPath(text, path)
      assert.ok(removed !== null, `remove ${where}`)
      const rest = JSON.parse(removed!)
      const parentPath = path.slice(0, -1)
      let parent: any = data
      for (const s of parentPath) parent = parent[s]
      const last = path[path.length - 1]
      const readded = JSON.parse(typeof last === 'string' ? addAtPath(removed!, parentPath, value, last)! : addAtPath(removed!, parentPath, value)!)
      if (typeof last === 'string') assert.deepEqual(readded, data, `add back ${where}`)
      else if (last === parent.length - 1) assert.deepEqual(readded, data, `add back ${where}`)
      assert.ok(rest !== undefined)
      edits++
    }
  }
  assert.ok(edits > 500, `exercised ${edits} edits across ${files.length} files`)
})

test('editing a value in an example scene from the tree leaves it a valid scene', () => {
  for (const e of examples) {
    const text = readFileSync(new URL(`${e.id}/${e.scene}`, root), 'utf8')
    const data = JSON.parse(text)
    const seed = setAtPath(text, ['seed'], (data.seed ?? 0) + 1)!
    const r = parseScene(seed)
    assert.ok(r.ok, `${e.id}: ${r.ok ? '' : r.errors.join('; ')}`)
  }
})
