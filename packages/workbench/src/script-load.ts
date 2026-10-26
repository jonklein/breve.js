import type { ScriptModule } from '@breve/core'

/** Turn script source text into a module (via a blob URL) and check it exports a controller. */
export async function compile(code: string): Promise<ScriptModule> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    const mod = (await import(/* @vite-ignore */ url)) as ScriptModule
    // a controller is any exported object with an `act` or `actAll` function: the default, or named kinds
    const isController = (v: unknown) => !!v && typeof v === 'object' && ['act', 'actAll', 'decide', 'decideAll', 'update'].some((k) => typeof (v as Record<string, unknown>)[k] === 'function')
    if (!Object.entries(mod).some(([k, v]) => k !== 'metrics' && isController(v)))
      throw new Error('the script must export a controller: `export default { act(obs, params, ctx) { ... } }` (lattices and networks may use `actAll`), or named ones like `export const Ant = { act() { ... } }`')
    return mod
  } finally {
    URL.revokeObjectURL(url)
  }
}
