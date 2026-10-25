import { Vec3, toVec, type VecLike } from '@breve/stdlib'

type Result = { steer?: VecLike; add?: Record<string, unknown>; state?: Record<string, unknown>; joints?: Record<string, number> } & Record<string, unknown>

/** Merge the results of several behaviors into one (see `ctx.blend`). Nothing, null and undefined are skipped. */
export function blend(...results: unknown[]): Result {
  const out: Result = {}
  for (const r of results as (Result | null | undefined)[]) {
    if (!r || typeof r !== 'object') continue
    for (const [key, v] of Object.entries(r)) {
      if (v === undefined) continue
      if (key === 'steer') out.steer = (out.steer ? toVec(out.steer) : Vec3.zero).plus(v as VecLike)
      else if (key === 'add') out.add = addUp(out.add ?? {}, v as Record<string, unknown>)
      else if (key === 'state' || key === 'joints') out[key] = { ...(out[key] as object), ...(v as object) } as never
      else out[key] = v
    }
  }
  return out
}

function addUp(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k]
    out[k] = typeof v === 'number' && typeof cur === 'number' ? cur + v
      : v && typeof v === 'object' && cur && typeof cur === 'object' ? addUp(cur as Record<string, unknown>, v as Record<string, unknown>)
      : v
  }
  return out
}
