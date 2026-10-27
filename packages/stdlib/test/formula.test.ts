import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Field, trace, interpret, validateProgram, hash01, saltOf, neighborOffsets, type Grid, type Formula } from '../src/index'

// a Field over the same grid the interpreter uses: the oracle every formula is checked against
function tableOf(grid: Grid) {
  const [nx, ny, nz] = grid.size
  const n = nx * ny * nz
  const offsets = neighborOffsets(grid)
  const nbr = new Int32Array(n * offsets.length), count = new Uint8Array(n)
  for (let row = 0; row < n; row++) {
    const i = row % nx, j = Math.floor(row / nx) % ny, k = Math.floor(row / (nx * ny))
    let c = 0
    for (const [di, dj, dk] of offsets) {
      let a = i + di, b = j + dj, d = k + dk
      if (grid.wrap) { a = (a + nx) % nx; b = (b + ny) % ny; d = (d + nz) % nz } else if (a < 0 || b < 0 || d < 0 || a >= nx || b >= ny || d >= nz) continue
      nbr[row * offsets.length + c++] = a + nx * (b + ny * d)
    }
    count[row] = c
  }
  return { nbr, count, stride: offsets.length }
}

const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
const randomState = (n: number, r: () => number, ints = false) => Float32Array.from({ length: n }, () => (ints ? Math.floor(r() * 3) : r() * 4 - 1))

const life: Formula = ({ alive, age }) => {
  const crowd = alive.neighborSum()
  const next = crowd.eq(3).or(alive.and(crowd.eq(2)))
  return { alive: next, age: next.where(age.add(1), 0) }
}

test('a traced formula gives the same cells as the same operations on real Fields, on wrapped and bounded grids', () => {
  for (const grid of [
    { size: [9, 7, 1], wrap: true }, { size: [9, 7, 1], wrap: false },
    { size: [4, 5, 3], wrap: true }, { size: [4, 5, 3], wrap: false, neighborhood: 'von-neumann' },
  ] as Grid[]) {
    const n = grid.size[0] * grid.size[1] * grid.size[2]
    const r = lcg(5)
    const alive = Float32Array.from({ length: n }, () => (r() < 0.4 ? 1 : 0)), age = randomState(n, r, true)
    const program = trace(life, ['alive', 'age'], [])
    const got = interpret(program, grid, { state: { alive, age } })
    const table = tableOf(grid)
    const want = life({ alive: new Field(alive, table), age: new Field(age, table) } as never, {} as never, {} as never) as unknown as Record<string, Field>
    assert.deepEqual(got.alive, want.alive.data, JSON.stringify(grid))
    assert.deepEqual(got.age, want.age.data, JSON.stringify(grid))
  }
})

test('every neighbor operation and every arithmetic operation matches Field, bit for bit (random formulas)', () => {
  const grid: Grid = { size: [6, 5, 1], wrap: false }
  const n = 30
  const table = tableOf(grid)
  const OPS = ['add', 'sub', 'mul', 'div', 'min', 'max', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or', 'where', 'clamp', 'sum', 'count', 'avg', 'nmax', 'not'] as const
  for (let trial = 0; trial < 60; trial++) {
    const r = lcg(100 + trial)
    // all the choices are made up front, so the formula is the same function whether it runs on expressions or on Fields
    const steps = Array.from({ length: 7 }, () => ({ op: OPS[Math.floor(r() * OPS.length)], a: r(), b: r(), use: Math.floor(r() * 3), num: Math.round((r() * 6 - 3) * 4) / 4 }))
    const formula = ((f: Record<string, any>, p: Record<string, any>) => {
      const pool: any[] = [f.a, f.b]
      for (const s of steps) {
        const x = pool[Math.floor(s.a * pool.length)]
        const y = s.use === 0 ? s.num : s.use === 1 ? p.gain : pool[Math.floor(s.b * pool.length)]
        const v = s.op === 'where' ? x.where(y, pool[0]) : s.op === 'clamp' ? x.clamp(-2, 2) : s.op === 'sum' ? x.neighborSum() : s.op === 'count' ? x.neighborCount()
          : s.op === 'avg' ? x.neighborAverage() : s.op === 'nmax' ? x.neighborMax() : s.op === 'not' ? x.not() : x[s.op](y)
        pool.push(v)
      }
      return { out: pool[pool.length - 1] }
    }) as unknown as Formula
    const state = { a: randomState(n, lcg(trial), true), b: randomState(n, lcg(trial + 1000)) }
    const got = interpret(trace(formula, ['a', 'b'], ['gain']), grid, { state, params: { gain: 0.3 } }).out
    const want = (formula({ a: new Field(state.a, table), b: new Field(state.b, table) } as never, { gain: 0.3 } as never, {} as never) as unknown as { out: Field }).out.data
    assert.deepEqual(Array.from(got, Object.is.bind(null, NaN)), Array.from(want, Object.is.bind(null, NaN)), `trial ${trial} (NaN placement)`)
    for (let i = 0; i < n; i++) assert.ok(Object.is(got[i], want[i]) || (Number.isNaN(got[i]) && Number.isNaN(want[i])), `trial ${trial} cell ${i}: ${got[i]} vs ${want[i]} (${steps.map((s) => s.op).join(',')})`)
  }
})

test('hash is the same for the same place and time, and different for different ones', () => {
  assert.equal(hash01(5, 3, 9, 1), hash01(5, 3, 9, 1))
  const seen = new Set<number>()
  for (let i = 0; i < 1000; i++) seen.add(hash01(i, 0, 1, 0))
  assert.ok(seen.size > 990, 'cells get different numbers')
  assert.notEqual(hash01(5, 3, 9, saltOf('birth')), hash01(5, 3, 9, saltOf('death')))
  assert.notEqual(hash01(5, 3, 9, 0), hash01(5, 4, 9, 0))
  let mean = 0
  for (let i = 0; i < 20000; i++) { const h = hash01(i, 7, 3, 0); assert.ok(h >= 0 && h < 1); mean += h }
  assert.ok(Math.abs(mean / 20000 - 0.5) < 0.01, 'spread evenly')
})

test('hash, coordinates and tick work inside a formula', () => {
  const grid: Grid = { size: [4, 3, 2], wrap: true }
  const program = trace((f, p, k) => ({ r: k.hash('fill'), x: k.x, y: k.y, z: k.z, i: k.index, t: k.tick, lit: k.hash('fill').lt(p.density) }), [], ['density'])
  const got = interpret(program, grid, { state: {}, params: { density: 0.5 }, tick: 7, seed: 11 })
  assert.equal(got.x[5], 1); assert.equal(got.y[5], 1); assert.equal(got.z[13], 1); assert.equal(got.i[17], 17); assert.equal(got.t[0], 7)
  assert.equal(got.r[9], hash01(9, 7, 11, saltOf('fill')))
  assert.equal(got.lit[9], hash01(9, 7, 11, saltOf('fill')) < 0.5 ? 1 : 0)
})

test('a formula that uses JavaScript where it needs the expression methods gets a readable error', () => {
  const bad = (f: Formula) => { try { trace(f, ['a'], ['p']); return '' } catch (e) { return (e as Error).message } }
  assert.match(bad(({ a }) => ({ a: (a as never as number) + 1 as never })), /expression has no number/)
  assert.match(bad(({ a }) => ({ a: a.zip() as never })), /JavaScript function/)
  assert.match(bad(({ a }) => ({ a: a.map() as never })), /JavaScript function/)
  assert.match(bad(({ a }) => ({ a: a.sum() as never })), /total over all cells/)
  assert.match(bad(({ b }) => ({ b })), /no field named "b" \(there is: a\)/)
  assert.match(bad((f, { q }) => ({ a: q })), /no parameter named "q" \(there is: p\)/)
  assert.match(bad(({ a }) => ({ a: a.add(Infinity) })), /finite/)
  assert.match(bad(() => ({ a: 'x' as never })), /must be an expression/)
  assert.match(bad(() => undefined as never), /must return an object/)
})

test('identical sub-expressions are one node, so a value used twice is worked out once', () => {
  const program = trace(({ a }) => { const c = a.neighborSum(); return { out: c.eq(3).or(a.and(c.eq(2))) } }, ['a'], [])
  assert.equal(program.nodes.filter((n) => n.k === 'nbr').length, 1)
  assert.equal(program.nodes.filter((n) => n.k === 'field').length, 1)
})

test('a program is plain data: it survives JSON, and bad programs are described', () => {
  const program = trace(life, ['alive', 'age'], [])
  assert.deepEqual(validateProgram(JSON.parse(JSON.stringify(program))), [])
  assert.match(validateProgram({ nodes: [{ k: 'bin', op: 'add', a: 0, b: 0 }], out: {}, fields: [], params: [] }).join('\n'), /nodes\.0\.a: must be the index of an earlier node/)
  assert.match(validateProgram({ nodes: [{ k: 'bin', op: 'pow', a: 0, b: 0 }], out: {}, fields: [], params: [] }).join('\n'), /nodes\.0\.op: must be one of/)
  assert.match(validateProgram({ nodes: [{ k: 'field', name: 'x' }], out: { r: 3 }, fields: ['y'], params: [] }).join('\n'), /must be one of program\.fields[\s\S]*out\.r/)
  assert.match(validateProgram({ nodes: [{ k: 'wat' }], out: {}, fields: [], params: [] }).join('\n'), /unknown kind "wat"/)
  assert.match(validateProgram(null).join('\n'), /must be an object/)
})
