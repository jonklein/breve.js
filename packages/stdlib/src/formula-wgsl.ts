/**
 * A formula program (see `formula.ts`) as a WGSL compute shader: one pass that reads every state field, works out the whole rule
 * for a cell in registers, and writes the results. It is plain text generation, so it needs no GPU to be written or tested; a host
 * with WebGPU compiles and runs it.
 *
 * What the passes here do:
 *  - only nodes a result needs are emitted (the rest of the graph is dropped), and each is computed once per cell (the tracer
 *    already merged identical sub-expressions);
 *  - comparisons and `and`/`or` give 1.0 or 0.0 like the CPU does, `min`/`max`/`clamp` pick the same value the CPU picks, and `hash`
 *    is the same integer mixer, so integer-valued rules (Life) match the interpreter exactly;
 *  - a neighbor operation needs its operand at the neighbors, and nothing is stored between operations, so the operand's own
 *    sub-graph is written as a function of a cell and called for each neighbor (the neighbors are unrolled, since the shape of the
 *    grid is known when this is generated). For an operand that is just a field this is one memory read per neighbor.
 *
 * Differences from the CPU, by design: sums of non-integer values add in 32-bit floats in a fixed order, where the CPU adds in
 * 64-bit and rounds once, so float rules can differ in the last bit or two. The interpreter is the exact reference.
 */
import { neighborOffsets, type BinOp, type Grid, type Node, type Program } from './formula'

export interface WgslModule {
  code: string
  /**
   * The state, as ONE storage buffer of f32 holding every field in `layout`, one after another (field `i` starts at `i * cells`).
   * The shader reads buffer `src` (binding 1) and writes buffer `dst` (binding 2), which has the same layout: it computes the fields
   * the program returns and copies the others through, so after a step `dst` is the whole new state and the two buffers swap roles.
   * (One buffer each, because many fields as separate buffers run into the per-stage limit of 8 on most devices.)
   */
  layout: string[]
  cells: number
  /** The fields the program computes (the rest of `layout` is copied through). */
  outputs: string[]
  /**
   * The uniform buffer (binding 0): bytes 0-3 are the tick (u32), 4-7 the seed (u32), then at `paramsOffset` one f32 per parameter in the
   * order of `params`. `size` is the buffer size to create.
   */
  uniform: { binding: number; size: number; params: string[]; paramsOffset: number }
  workgroupSize: [number, number, number]
  /** How many workgroups to dispatch in each direction. */
  dispatch: [number, number, number]
}

const WG: [number, number, number] = [8, 8, 1]

/** An f32 literal that reads back as exactly this value. */
function lit(v: number): string {
  if (Object.is(v, -0)) return '-0.0'
  const s = Number.isInteger(v) && Math.abs(v) < 1e9 ? `${v}.0` : v.toPrecision(9)
  return v < 0 ? `(${s})` : s
}

const cmp: Partial<Record<BinOp, string>> = { eq: '==', ne: '!=', lt: '<', le: '<=', gt: '>', ge: '>=' }
const arith: Partial<Record<BinOp, string>> = { add: '+', sub: '-', mul: '*', div: '/' }

/** What this node needs at the same cell. A neighbor operation looks at its operand at other cells, which is a function of its own. */
function localDeps(n: Node): number[] {
  switch (n.k) {
    case 'bin': return [n.a, n.b]
    case 'where': return [n.c, n.a, n.b]
    case 'clamp': return [n.a]
    default: return []
  }
}

/**
 * `fields` is the whole state of the set, in the order the buffer holds it (default: the fields the program reads, then any it
 * returns that it did not read).
 */
export function toWgsl(program: Program, grid: Grid, fields?: string[]): WgslModule {
  const [nx, ny, nz] = grid.size
  const offsets = neighborOffsets(grid)
  const nodes = program.nodes
  const outputs = Object.keys(program.out)
  const layout = fields ? [...fields] : program.fields.filter((f) => nodes.some((n) => n.k === 'field' && n.name === f))
  for (const name of [...program.fields, ...outputs]) if (!layout.includes(name)) { if (fields) throw new Error(`the state has no field "${name}" (it has: ${fields.join(', ')})`); layout.push(name) }
  const cells = nx * ny * nz
  const slot = new Map(layout.map((f, i) => [f, i]))
  const paramSlot = new Map(program.params.map((p, i) => [p, i]))

  /** The nodes needed to work out these roots in one cell, in order. */
  const needed = (roots: number[]): number[] => {
    const seen = new Set<number>()
    const visit = (i: number) => { if (seen.has(i)) return; seen.add(i); localDeps(nodes[i]).forEach(visit) }
    roots.forEach(visit)
    return [...seen].sort((a, b) => a - b)
  }

  const idx = (c: string) => `u32(${c}.x + ${nx} * (${c}.y + ${ny} * ${c}.z))`

  const expr = (id: number, c: string): string => {
    const n = nodes[id]
    const v = (i: number) => `n${i}`
    switch (n.k) {
      case 'num': return lit(n.v)
      case 'field': return `src[${slot.get(n.name)! * cells}u + ${idx(c)}]`
      case 'param': return `u.p[${paramSlot.get(n.name)! >> 2}][${paramSlot.get(n.name)! & 3}]`
      case 'coord': return `f32(${c}.${'xyz'[n.axis]})`
      case 'index': return `f32(${idx(c)})`
      case 'tick': return 'f32(u.tick)'
      case 'hash': return `hash01(${idx(c)}, u.tick, u.seed, ${n.salt >>> 0}u)`
      case 'where': return `select(${v(n.b)}, ${v(n.a)}, ${v(n.c)} != 0.0)`
      case 'clamp': return `select(select(${v(n.a)}, ${lit(n.hi)}, ${v(n.a)} > ${lit(n.hi)}), ${lit(n.lo)}, ${v(n.a)} < ${lit(n.lo)})`
      case 'nbr': return `nb${id}(${c})`
      case 'bin': {
        const a = v(n.a), b = v(n.b)
        if (arith[n.op]) return `${a} ${arith[n.op]} ${b}`
        if (cmp[n.op]) return `select(0.0, 1.0, ${a} ${cmp[n.op]} ${b})`
        if (n.op === 'min') return `select(${b}, ${a}, ${a} < ${b})`
        if (n.op === 'max') return `select(${b}, ${a}, ${a} > ${b})`
        if (n.op === 'and') return `select(0.0, 1.0, ${a} != 0.0 && ${b} != 0.0)`
        return `select(0.0, 1.0, ${a} != 0.0 || ${b} != 0.0)` // or
      }
    }
  }

  const lines = (ids: number[], c: string, pad: string): string[] => ids.map((id) => `${pad}let n${id}: f32 = ${expr(id, c)};`)

  // one function per neighbor operation: its operand, worked out at each neighbor, combined
  const fns: string[] = []
  nodes.forEach((n, id) => {
    if (n.k !== 'nbr') return
    const body = lines(needed([n.a]), 'q', '    ')
    const at = (di: number, dj: number, dk: number) => {
      const coords = [['x', di, nx], ['y', dj, ny], ['z', dk, nz]] as const
      const wrapped = coords.map(([a, d, size]) => (grid.wrap ? `((c.${a} + ${d + size}) % ${size})` : `c.${a} + ${d}`))
      const inside = coords.filter(([, d]) => d !== 0).map(([a, d, size]) => (d < 0 ? `c.${a} + ${d} >= 0` : `c.${a} + ${d} < ${size}`))
      return { q: `vec3<i32>(${wrapped.join(', ')})`, inside: grid.wrap || !inside.length ? 'true' : inside.join(' && ') }
    }
    const out: string[] = [`fn nb${id}(c: vec3<i32>) -> f32 {`]
    out.push('  var s: f32 = 0.0;', '  var k: f32 = 0.0;', ...(n.op === 'max' ? ['  var m: f32 = -3.4e38;'] : []))
    for (const [di, dj, dk] of offsets) {
      const { q, inside } = at(di, dj, dk)
      out.push(`  if (${inside}) {`, `    let q = ${q};`, ...body)
      out.push(n.op === 'max' ? `    m = select(m, n${n.a}, n${n.a} > m);` : `    s = s + n${n.a};`, '    k = k + 1.0;', '  }')
    }
    out.push(n.op === 'count' ? '  return k;' : n.op === 'sum' ? '  return s;' : n.op === 'avg' ? '  return select(0.0, s / k, k > 0.0);' : '  return select(0.0, m, k > 0.0);', '}', '')
    fns.push(out.join('\n'))
  })

  const code = [
    '// generated from a breve formula: do not edit',
    'struct U { tick: u32, seed: u32, pad0: u32, pad1: u32, p: array<vec4<f32>, ' + Math.max(1, Math.ceil(program.params.length / 4)) + '> }',
    '@group(0) @binding(0) var<uniform> u: U;',
    '@group(0) @binding(1) var<storage, read> src: array<f32>;',
    '@group(0) @binding(2) var<storage, read_write> dst: array<f32>;',
    '',
    'fn mix32(x: u32) -> u32 {',
    '  var h = x;',
    '  h = h ^ (h >> 16u);',
    '  h = h * 0x7feb352du;',
    '  h = h ^ (h >> 15u);',
    '  h = h * 0x846ca68bu;',
    '  h = h ^ (h >> 16u);',
    '  return h;',
    '}',
    'fn hash01(index: u32, tick: u32, seed: u32, salt: u32) -> f32 {',
    '  var h = mix32(seed ^ (salt * 0x9e3779b9u));',
    '  h = mix32(h + tick * 0x85ebca6bu);',
    '  h = mix32(h + index * 0xc2b2ae35u);',
    '  return f32(h >> 8u) * (1.0 / 16777216.0);',
    '}',
    '',
    ...fns,
    `@compute @workgroup_size(${WG.join(', ')})`,
    'fn main(@builtin(global_invocation_id) g: vec3<u32>) {',
    `  if (g.x >= ${nx}u || g.y >= ${ny}u || g.z >= ${nz}u) { return; }`,
    '  let c = vec3<i32>(g);',
    ...lines(needed(Object.values(program.out)), 'c', '  '),
    ...outputs.map((f) => `  dst[${slot.get(f)! * cells}u + ${idx('c')}] = n${program.out[f]};`),
    ...layout.filter((f) => !outputs.includes(f)).map((f) => `  dst[${slot.get(f)! * cells}u + ${idx('c')}] = src[${slot.get(f)! * cells}u + ${idx('c')}];`),
    '}',
    '',
  ].join('\n')

  return {
    code,
    layout,
    cells,
    outputs,
    uniform: { binding: 0, size: 16 + 16 * Math.max(1, Math.ceil(program.params.length / 4)), params: [...program.params], paramsOffset: 16 },
    workgroupSize: WG,
    dispatch: [Math.ceil(nx / WG[0]), Math.ceil(ny / WG[1]), Math.ceil(nz / WG[2])],
  }
}
