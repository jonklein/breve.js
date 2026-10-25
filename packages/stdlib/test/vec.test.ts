import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vec3, Vecs, Agents } from '../src/index'

// anything with a position and velocity can be grouped
class Agent {
  constructor(private c: Record<string, Float32Array>, private i: number) {}
  get position() { return new Vec3(this.c.px[this.i], this.c.py[this.i], this.c.pz[this.i]) }
  get velocity() { return new Vec3(this.c.vx[this.i], this.c.vy[this.i], this.c.vz[this.i]) }
}

const v = (x: number, y: number, z: number) => new Vec3(x, y, z)

test('Vec3 arithmetic chains and never mutates', () => {
  const a = v(1, 2, 3)
  const b = a.plus(v(1, 1, 1)).times(2).minus(v(0, 0, 1))
  assert.deepEqual(b.toArray(), [4, 6, 7])
  assert.deepEqual(a.toArray(), [1, 2, 3])
  assert.equal(v(3, 4, 0).length(), 5)
  assert.deepEqual(v(0, 0, 0).normalized().toArray(), [0, 0, 0])
  assert.equal(v(10, 0, 0).limit(2).length(), 2)
  assert.deepEqual(v(1, 0, 0).cross(v(0, 1, 0)).toArray(), [0, 0, 1])
})

test('Vecs apply to every element, and empty lists are safe', () => {
  const list = Vecs.from([v(1, 0, 0), v(3, 0, 0)]) as Vecs
  assert.deepEqual(list.average().toArray(), [2, 0, 0])
  assert.deepEqual(list.minus(v(1, 0, 0)).sum().toArray(), [2, 0, 0])
  assert.deepEqual(new Vecs().average().toArray(), [0, 0, 0])
  assert.equal(new Vecs().isEmpty(), true)
})

test('Agents answer questions about the whole group', () => {
  const px = Float32Array.of(0, 3, 0, 10)
  const zero = new Float32Array(4)
  const cols = { px, py: zero, pz: zero, vx: Float32Array.of(1, 2, 3, 4), vy: zero, vz: zero }
  const all = Array.from({ length: 4 }, (_, i) => new Agent(cols, i))
  const me = all[0]
  const group = new Agents(me)
  group.push(all[1], all[2], all[3])

  assert.deepEqual(group.velocity.average().toArray(), [3, 0, 0])
  assert.deepEqual(Array.from(group.offset, (o) => o.x), [3, 0, 10])
  assert.equal(group.within(5).length, 2)
  assert.equal(group.nearest(), all[2])
  assert.throws(() => new Agents(null).offset, /needs a group that belongs to an agent/)
})
