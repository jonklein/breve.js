import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Colors, Field } from '../src/index'

const near = (a: ArrayLike<number>, b: number[], eps = 1e-6) => b.forEach((v, i) => assert.ok(Math.abs(a[i] - v) < eps, `${Array.from(a)} vs ${b}`))

test('colors: hex, hsl and ramps', () => {
  near(Colors.hex('#ff8000'), [1, 128 / 255, 0])
  near(Colors.hex('#0f0'), [0, 1, 0])
  near(Colors.hex('nonsense'), [1, 1, 1])
  near(Colors.hsl(0, 1, 0.5), [1, 0, 0])
  near(Colors.hsl(1 / 3, 1, 0.5), [0, 1, 0])
  near(Colors.hsl(0.5, 0, 0.4), [0.4, 0.4, 0.4])
  near(Colors.ramp(['#000000', '#ffffff'], 0.25), [0.25, 0.25, 0.25])
  near(Colors.ramp(['#ff0000', '#00ff00', '#0000ff'], 0.5), [0, 1, 0])
  near(Colors.ramp(['#ff0000', '#0000ff'], 5), [0, 0, 1], 1e-6) // held at the ends
  near(Colors.ramp(['#ff0000', '#0000ff'], NaN), [1, 0, 0])
  near(Colors.ramp(['#123456'], 0.7), Colors.hex('#123456'))
})

test('rampField gives the same colors as ramp, a cell at a time', () => {
  const table = { nbr: new Int32Array(0), count: new Uint8Array(4), stride: 1 }
  const t = new Field(Float32Array.of(0, 0.3, 0.75, 1), table)
  const stops = ['#112233', '#ddeeff', '#ff0000']
  const f = Colors.rampField(stops, t)
  for (let i = 0; i < 4; i++) near([f.r[i], f.g[i], f.b[i]], Colors.ramp(stops, t.data[i]), 1e-6)
  assert.equal(Colors.rampField(stops, [0.5]).r.length, 1)
})
