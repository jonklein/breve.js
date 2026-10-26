import type { JsonPath } from '@breve/core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Schema = Record<string, any>

/** The plain schemas inside a node: an `anyOf` (a number or a "$param" text, say) lists several. */
export function branches(n: Schema | null | undefined): Schema[] {
  if (!n) return []
  const alts = (n.anyOf ?? n.oneOf) as Schema[] | undefined
  return alts ? alts.flatMap(branches) : [n]
}

/** The schema for the value at `path`, or null when the schema does not say (an unknown key, say). Alternatives are kept together as an `anyOf`. */
export function schemaAt(root: Schema, path: JsonPath): Schema | null {
  let nodes: Schema[] = branches(root)
  for (const step of path) {
    nodes = nodes.flatMap((n) => {
      if (typeof step === 'number') return n.items ? [n.items as Schema] : []
      const own = n.properties?.[step] as Schema | undefined
      if (own) return [own]
      return n.additionalProperties && typeof n.additionalProperties === 'object' ? [n.additionalProperties as Schema] : []
    }).flatMap(branches)
  }
  return nodes.length === 0 ? null : nodes.length === 1 ? nodes[0] : { anyOf: nodes }
}

export interface Hints {
  /** Fixed choices, drawn as a dropdown. */
  choices: unknown[] | null
  /** Text that is a color, drawn with a color picker. */
  color: boolean
  /** The value may be a "$param" reference instead of its usual type. */
  acceptsParam: boolean
  /** Names the schema gives to an object's fields, in order. */
  fields: string[]
  /** What each new list item or map value should look like. */
  child: Schema | null
  numberRange: { min?: number; max?: number; step?: number }
}

export function hintsOf(node: Schema | null): Hints {
  const bs = branches(node)
  const choices = bs.find((b) => Array.isArray(b.enum))?.enum ?? (bs.find((b) => 'const' in b) ? bs.filter((b) => 'const' in b).map((b) => b.const) : null)
  const color = bs.some((b) => typeof b.pattern === 'string' && b.pattern.startsWith('^#('))
  const acceptsParam = bs.some((b) => b.type === 'string' && typeof b.pattern === 'string' && b.pattern.startsWith('^\\$'))
  const fields = [...new Set(bs.flatMap((b) => Object.keys(b.properties ?? {})))]
  const child = bs.find((b) => b.items)?.items ?? bs.find((b) => b.additionalProperties && typeof b.additionalProperties === 'object')?.additionalProperties ?? null
  const num = bs.find((b) => b.type === 'number' || b.type === 'integer')
  return {
    choices,
    color,
    acceptsParam,
    fields,
    child,
    numberRange: { min: num?.minimum ?? num?.exclusiveMinimum, max: num?.maximum, step: num?.type === 'integer' ? 1 : undefined },
  }
}

/** A starting value for something the schema describes: what "add" puts in. */
export function defaultFor(node: Schema | null, depth = 0): unknown {
  const bs = branches(node)
  const n = bs.find((b) => b.type === 'number' || b.type === 'integer') ?? bs[0]
  if (!n) return 0
  if (n.default !== undefined) return n.default
  if (Array.isArray(n.enum)) return n.enum[0]
  if ('const' in n) return n.const
  switch (n.type) {
    case 'number': case 'integer': {
      let v = n.minimum ?? (n.exclusiveMinimum !== undefined ? n.exclusiveMinimum + 1 : 0)
      if (n.maximum !== undefined) v = Math.min(v, n.maximum)
      return v
    }
    case 'string': return ''
    case 'boolean': return false
    case 'array': return []
    case 'object': {
      const out: Record<string, unknown> = {}
      if (depth < 3) for (const k of (n.required ?? []) as string[]) out[k] = defaultFor(n.properties?.[k] ?? null, depth + 1)
      return out
    }
    default: return 0
  }
}
