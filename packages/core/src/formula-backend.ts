import type { FormulaBackend } from '@breve/stdlib'

/** How a backend is loaded. It resolves to null where the machine cannot run it (no graphics card), and the sim then uses the processor. */
export type FormulaBackendLoader = () => Promise<FormulaBackend | null>

let loader: FormulaBackendLoader | null = null
let loaded: Promise<FormulaBackend | null> | null = null

/**
 * Make a backend that keeps lattice state on a graphics card available to scenes. The core never imports one (rule: it has no
 * DOM or GPU API); the host registers it, as it does a physics engine. Without one, formulas run on the CPU interpreter and give the same cells.
 */
export function registerFormulaBackend(load: FormulaBackendLoader): void {
  loader = load
  loaded = null
}

/** The registered backend (loaded once), or null if there is none or it is not available here. */
export function loadFormulaBackend(): Promise<FormulaBackend | null> {
  if (!loader) return Promise.resolve(null)
  return (loaded ??= loader().catch(() => null))
}
