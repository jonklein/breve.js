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
    case 'un': return [n.a]
    case 'bin': return [n.a, n.b]
    case 'where': return [n.c, n.a, n.b]
    case 'clamp': return [n.a]
    default: return []
  }
}

const PRELUDE = [
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
]

/** The pieces every kind of shader is made from: how to read a field, how a node is worked out in a cell, the neighbor functions. */
function emitter(program: Program, grid: Grid, layout: string[]) {
  const [nx, ny, nz] = grid.size
  const offsets = neighborOffsets(grid)
  const nodes = program.nodes
  const cells = nx * ny * nz
  const slot = new Map(layout.map((f, i) => [f, i]))
  const paramSlot = new Map(program.params.map((p, i) => [p, i]))
  const paramCount = Math.max(1, Math.ceil(program.params.length / 4))

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
      case 'rand': return `hash01(0u, u.tick, u.seed, ${n.salt >>> 0}u)`
      case 'where': return `select(${v(n.b)}, ${v(n.a)}, ${v(n.c)} != 0.0)`
      case 'clamp': return `select(select(${v(n.a)}, ${lit(n.hi)}, ${v(n.a)} > ${lit(n.hi)}), ${lit(n.lo)}, ${v(n.a)} < ${lit(n.lo)})`
      case 'nbr': return `nb${id}(${c})`
      case 'un': return n.op === 'neg' ? `-${v(n.a)}` : `${n.op}(${v(n.a)})`
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

  return { nx, ny, nz, cells, slot, needed, idx, lines, fns, paramCount }
}

const wgs = (g: [number, number, number]) => `@compute @workgroup_size(${g.join(', ')})`

/**
 * `fields` is the whole state of the set, in the order the buffer holds it (default: the fields the program reads, then any it
 * returns that it did not read).
 */
export function toWgsl(program: Program, grid: Grid, fields?: string[]): WgslModule {
  const nodes = program.nodes
  const outputs = Object.keys(program.out)
  const layout = fields ? [...fields] : program.fields.filter((f) => nodes.some((n) => n.k === 'field' && n.name === f))
  for (const name of [...program.fields, ...outputs]) if (!layout.includes(name)) { if (fields) throw new Error(`the state has no field "${name}" (it has: ${fields.join(', ')})`); layout.push(name) }
  const e = emitter(program, grid, layout)
  const { nx, ny, nz, cells, slot, idx } = e

  const code = [
    '// generated from a breve formula: do not edit',
    'struct U { tick: u32, seed: u32, pad0: u32, pad1: u32, p: array<vec4<f32>, ' + e.paramCount + '> }',
    '@group(0) @binding(0) var<uniform> u: U;',
    '@group(0) @binding(1) var<storage, read> src: array<f32>;',
    '@group(0) @binding(2) var<storage, read_write> dst: array<f32>;',
    '',
    ...PRELUDE,
    '',
    ...e.fns,
    wgs(WG),
    'fn main(@builtin(global_invocation_id) g: vec3<u32>) {',
    `  if (g.x >= ${nx}u || g.y >= ${ny}u || g.z >= ${nz}u) { return; }`,
    '  let c = vec3<i32>(g);',
    ...e.lines(e.needed(Object.values(program.out)), 'c', '  '),
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
    uniform: { binding: 0, size: 16 + 16 * e.paramCount, params: [...program.params], paramsOffset: 16 },
    workgroupSize: WG,
    dispatch: [Math.ceil(nx / WG[0]), Math.ceil(ny / WG[1]), Math.ceil(nz / WG[2])],
  }
}

/** A shader that draws a window of the grid into a picture. */
export interface WgslImageModule {
  code: string
  layout: string[]
  cells: number
  /**
   * Uniform buffer (binding 0), in bytes: tick u32 at 0, seed u32 at 4, width u32 at 8, height u32 at 12, then four f32 at 16: the window's
   * left, top, right and bottom edges in cells (a cell is one unit; the left edge of cell 0 is 0), then three f32 at 32: the background
   * color (0 to 1) shown where a cell is not visible, a f32 at 44: the layer (z) to draw, then one f32 per parameter at `paramsOffset`.
   */
  uniform: { binding: number; size: number; params: string[]; paramsOffset: number }
  /** State is read from `src` (binding 1, the layout above); pixels are written to `pixels` (binding 2), one u32 each (red in the lowest byte, alpha 255). */
  workgroupSize: [number, number, number]
  /** Workgroups to dispatch for a picture of this size. */
  dispatchFor(width: number, height: number): [number, number, number]
}

/**
 * The look of a lattice as a picture: each pixel finds the cell under it and works out `visible`, `r`, `g`, `b` (the program's outputs, colors
 * between 0 and 1) there. Zooming and panning only change the window, so a huge grid is drawn at the size of the screen, never cell by cell.
 */
export function toWgslImage(program: Program, grid: Grid, fields: string[]): WgslImageModule {
  const nodes = program.nodes
  for (const name of program.fields) if (!fields.includes(name)) throw new Error(`the state has no field "${name}" (it has: ${fields.join(', ')})`)
  void nodes
  const e = emitter(program, grid, fields)
  const { nx, ny, nz, cells } = e
  const out = (name: string, fallback: string) => (name in program.out ? `n${program.out[name]}` : fallback)
  const roots = ['visible', 'r', 'g', 'b'].filter((k) => k in program.out).map((k) => program.out[k])
  const chan = (v: string) => `u32(clamp(${v}, 0.0, 1.0) * 255.0 + 0.5)`
  const code = [
    '// generated from a breve formula (a picture of the grid): do not edit',
    'struct U { tick: u32, seed: u32, width: u32, height: u32, win: vec4<f32>, bg: vec3<f32>, layer: f32, p: array<vec4<f32>, ' + e.paramCount + '> }',
    '@group(0) @binding(0) var<uniform> u: U;',
    '@group(0) @binding(1) var<storage, read> src: array<f32>;',
    '@group(0) @binding(2) var<storage, read_write> pixels: array<u32>;',
    '',
    ...PRELUDE,
    '',
    ...e.fns,
    wgs(WG),
    'fn main(@builtin(global_invocation_id) g: vec3<u32>) {',
    '  if (g.x >= u.width || g.y >= u.height) { return; }',
    '  let fx = u.win.x + (f32(g.x) + 0.5) * (u.win.z - u.win.x) / f32(u.width);',
    '  let fy = u.win.y + (f32(g.y) + 0.5) * (u.win.w - u.win.y) / f32(u.height);',
    `  let c = vec3<i32>(clamp(i32(floor(fx)), 0, ${nx - 1}), clamp(i32(floor(fy)), 0, ${ny - 1}), clamp(i32(u.layer), 0, ${nz - 1}));`,
    '  let inside = fx >= 0.0 && fy >= 0.0 && fx < ' + lit(nx) + ' && fy < ' + lit(ny) + ';',
    ...e.lines(e.needed(roots), 'c', '  '),
    `  let shown = inside && ${out('visible', '1.0')} != 0.0;`,
    `  let rgb = select(u.bg, vec3<f32>(${out('r', '1.0')}, ${out('g', '1.0')}, ${out('b', '1.0')}), shown);`,
    `  pixels[g.y * u.width + g.x] = ${chan('rgb.x')} | (${chan('rgb.y')} << 8u) | (${chan('rgb.z')} << 16u) | (255u << 24u);`,
    '}',
    '',
  ].join('\n')
  return {
    code,
    layout: [...fields],
    cells,
    uniform: { binding: 0, size: 48 + 16 * e.paramCount, params: [...program.params], paramsOffset: 48 },
    workgroupSize: WG,
    dispatchFor: (w, h) => [Math.ceil(w / WG[0]), Math.ceil(h / WG[1]), 1],
  }
}

export interface WgslCellsModule {
  code: string
  layout: string[]
  cells: number
  /** Same uniform as the picture shader (only the tick, seed and parameters are used). */
  uniform: { binding: number; size: number; params: string[]; paramsOffset: number }
  workgroupSize: [number, number, number]
  dispatch: [number, number, number]
}

/**
 * The look of every cell of a (3D) lattice: `pixels` (binding 2) gets one u32 per cell in grid order (x fastest, then y, then z): red in the
 * lowest byte, then green, blue, and alpha 255 where the program's `visible` is not 0 and 0 where it is. For drawing each cell as an object.
 */
export function toWgslCells(program: Program, grid: Grid, fields: string[]): WgslCellsModule {
  for (const name of program.fields) if (!fields.includes(name)) throw new Error(`the state has no field "${name}" (it has: ${fields.join(', ')})`)
  const e = emitter(program, grid, fields)
  const { nx, ny, nz, cells } = e
  const out = (name: string, fallback: string) => (name in program.out ? `n${program.out[name]}` : fallback)
  const roots = ['visible', 'r', 'g', 'b'].filter((k) => k in program.out).map((k) => program.out[k])
  const chan = (v: string) => `u32(clamp(${v}, 0.0, 1.0) * 255.0 + 0.5)`
  const wg: [number, number, number] = [4, 4, 4]
  const code = [
    '// generated from a breve formula (the look of every cell): do not edit',
    'struct U { tick: u32, seed: u32, width: u32, height: u32, win: vec4<f32>, bg: vec3<f32>, layer: f32, p: array<vec4<f32>, ' + e.paramCount + '> }',
    '@group(0) @binding(0) var<uniform> u: U;',
    '@group(0) @binding(1) var<storage, read> src: array<f32>;',
    '@group(0) @binding(2) var<storage, read_write> pixels: array<u32>;',
    '',
    ...PRELUDE,
    '',
    ...e.fns,
    wgs(wg),
    'fn main(@builtin(global_invocation_id) g: vec3<u32>) {',
    `  if (g.x >= ${nx}u || g.y >= ${ny}u || g.z >= ${nz}u) { return; }`,
    '  let c = vec3<i32>(g);',
    ...e.lines(e.needed(roots), 'c', '  '),
    `  let shown = ${out('visible', '1.0')} != 0.0;`,
    `  let a = select(0u, 255u, shown);`,
    `  pixels[(g.z * ${ny}u + g.y) * ${nx}u + g.x] = ${chan(out('r', '1.0'))} | (${chan(out('g', '1.0'))} << 8u) | (${chan(out('b', '1.0'))} << 16u) | (a << 24u);`,
    '}',
    '',
  ].join('\n')
  return {
    code,
    layout: [...fields],
    cells,
    uniform: { binding: 0, size: 48 + 16 * e.paramCount, params: [...program.params], paramsOffset: 48 },
    workgroupSize: wg,
    dispatch: [Math.ceil(nx / wg[0]), Math.ceil(ny / wg[1]), Math.ceil(nz / wg[2])],
  }
}

/** A shader that totals expressions over the whole grid (metrics): one partial total per workgroup, which the host adds up. */
export interface WgslReduceModule {
  code: string
  layout: string[]
  cells: number
  /** What each total is, in the order the partials are stored. */
  totals: { name: string; op: 'sum' | 'average' }[]
  uniform: { binding: number; size: number; params: string[]; paramsOffset: number }
  workgroupSize: [number, number, number]
  dispatch: [number, number, number]
  /** Workgroups per total: `partials` (binding 2, f32) holds `totals.length * groups` numbers, the first total's groups first. */
  groups: number
}

export function toWgslReduce(program: Program, grid: Grid, fields: string[]): WgslReduceModule {
  const reduce = Object.entries(program.reduce ?? {})
  for (const name of program.fields) if (!fields.includes(name)) throw new Error(`the state has no field "${name}" (it has: ${fields.join(', ')})`)
  const e = emitter(program, grid, fields)
  const { nx, ny, nz, cells } = e
  const dispatch: [number, number, number] = [Math.ceil(nx / WG[0]), Math.ceil(ny / WG[1]), nz]
  const groups = dispatch[0] * dispatch[1] * dispatch[2]
  const size = WG[0] * WG[1] * WG[2]
  const code = [
    '// generated from a breve metric: do not edit',
    'struct U { tick: u32, seed: u32, pad0: u32, pad1: u32, p: array<vec4<f32>, ' + e.paramCount + '> }',
    '@group(0) @binding(0) var<uniform> u: U;',
    '@group(0) @binding(1) var<storage, read> src: array<f32>;',
    '@group(0) @binding(2) var<storage, read_write> partials: array<f32>;',
    ...reduce.map((_, i) => `var<workgroup> part${i}: array<f32, ${size}>;`),
    '',
    ...PRELUDE,
    '',
    ...e.fns,
    wgs(WG),
    'fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {',
    `  let valid = g.x < ${nx}u && g.y < ${ny}u && g.z < ${nz}u;`,
    `  let c = vec3<i32>(vec3<u32>(min(g.x, ${nx - 1}u), min(g.y, ${ny - 1}u), min(g.z, ${nz - 1}u)));`,
    ...e.lines(e.needed(reduce.map(([, r]) => r.node)), 'c', '  '),
    ...reduce.map(([, r], i) => `  part${i}[li] = select(0.0, n${r.node}, valid);`),
    '  workgroupBarrier();',
    ...[...Array(Math.log2(size))].flatMap((_, k) => {
      const half = size >> (k + 1)
      return [`  if (li < ${half}u) {`, ...reduce.map((__, i) => `    part${i}[li] = part${i}[li] + part${i}[li + ${half}u];`), '  }', '  workgroupBarrier();']
    }),
    '  if (li == 0u) {',
    '    let group = wg.x + nw.x * (wg.y + nw.y * wg.z);',
    ...reduce.map((_, i) => `    partials[${i}u * ${groups}u + group] = part${i}[0];`),
    '  }',
    '}',
    '',
  ].join('\n')
  return {
    code,
    layout: [...fields],
    cells,
    totals: reduce.map(([name, r]) => ({ name, op: r.op })),
    uniform: { binding: 0, size: 16 + 16 * e.paramCount, params: [...program.params], paramsOffset: 16 },
    workgroupSize: WG,
    dispatch,
    groups,
  }
}
