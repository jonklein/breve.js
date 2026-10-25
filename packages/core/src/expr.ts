/**
 * Numbers in a scene may be arithmetic on params: `"$legLength * 0.5 + 0.1"`. This evaluates such a text with the
 * current param values. It understands numbers, `$name`, + - * /, unary minus and parentheses, and nothing else.
 */
export function evalNumber(v: number | string, params: Record<string, number>, where = 'value'): number {
  if (typeof v === 'number') return v
  let i = 0
  const s = v
  const fail = (msg: string): never => { throw new Error(`${where}: ${msg} in "${v}"`) }
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++ }
  const primary = (): number => {
    ws()
    if (s[i] === '(') { i++; const x = sum(); ws(); if (s[i] !== ')') fail('missing ")"'); i++; return x }
    if (s[i] === '-') { i++; return -primary() }
    if (s[i] === '+') { i++; return primary() }
    if (s[i] === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(s.slice(i))
      if (!m) return fail('expected a param name after "$"')
      i += m[0].length
      if (!(m[1] in params)) fail(`unknown param "$${m[1]}"`)
      return params[m[1]]
    }
    const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i))
    if (!m) return fail(`unexpected "${s[i] ?? 'end'}"`)
    i += m[0].length
    return Number(m[0])
  }
  const product = (): number => {
    let x = primary()
    for (;;) {
      ws()
      if (s[i] === '*') { i++; x *= primary() }
      else if (s[i] === '/') { i++; x /= primary() }
      else return x
    }
  }
  const sum = (): number => {
    let x = product()
    for (;;) {
      ws()
      if (s[i] === '+') { i++; x += product() }
      else if (s[i] === '-') { i++; x -= product() }
      else return x
    }
  }
  const out = sum()
  ws()
  if (i < s.length) fail(`unexpected "${s[i]}"`)
  if (!Number.isFinite(out)) fail('does not give a finite number')
  return out
}
