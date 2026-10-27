/**
 * Formula hooks (`initFormula`, `actFormula`, `displayFormula`): a whole-set rule written once as an expression (see
 * `@breve/stdlib` formula). The script's function runs ONCE to give a program; the program then runs for every cell, each tick,
 * with the scene's parameters as inputs. Programs are kept per function, so editing the script makes a new one.
 */
import { interpret, trace, type Formula, type Grid, type Program } from '@breve/stdlib'

const programs = new WeakMap<Formula, Map<string, Program>>()

/** The program a formula function describes, for these state fields and parameters (worked out once, then remembered). */
export function programOf(fn: Formula, fields: string[], params: string[]): Program {
  let byShape = programs.get(fn)
  if (!byShape) programs.set(fn, (byShape = new Map()))
  const key = JSON.stringify([fields, params])
  let p = byShape.get(key)
  if (!p) byShape.set(key, (p = trace(fn, fields, params)))
  return p
}

export interface FormulaRun {
  state: Record<string, ArrayLike<number>>
  params: Record<string, number>
  tick: number
  seed: number
}

/** Run a formula's program for every cell and return its result fields. */
export function runFormula(fn: Formula, grid: Grid, fields: string[], run: FormulaRun): Record<string, Float32Array> {
  return interpret(programOf(fn, fields, Object.keys(run.params)), grid, run)
}
