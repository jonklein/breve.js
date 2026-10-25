import type { Rng } from './rng'
import type { SpawnDef } from './scene'

/** Where a new entity starts, from the scene's `spawn` block: a point (with optional scatter) or a box. Null when there is none. */
export function spawnPosition(spawn: SpawnDef | undefined, rng: Rng, flat = false): [number, number, number] | null {
  if (!spawn) return null
  if (spawn.box) {
    const [a, b] = spawn.box
    return [rng.range(a[0], b[0]), flat ? 0 : rng.range(a[1], b[1]), rng.range(a[2], b[2])]
  }
  if (spawn.at) {
    const r = spawn.spread ?? 0
    if (r <= 0) return [...spawn.at]
    // a random point inside a ball (a disc when flat), uniformly
    for (;;) {
      const x = rng.range(-1, 1), y = flat ? 0 : rng.range(-1, 1), z = rng.range(-1, 1)
      if (x * x + y * y + z * z <= 1) return [spawn.at[0] + x * r, flat ? 0 : spawn.at[1] + y * r, spawn.at[2] + z * r]
    }
  }
  return null
}
