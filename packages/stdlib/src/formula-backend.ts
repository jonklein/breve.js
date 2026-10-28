/**
 * What runs a formula program. The CPU interpreter is the reference; a backend with a graphics card keeps the state of a lattice
 * on the card, so a tick is one dispatch and nothing crosses to the processor until someone asks (`download`, `totals`, `image`).
 * The interface is plain data in, plain data out, so `@breve/core` can use it without knowing about WebGPU (the host registers it).
 */
import type { Grid, Program } from './formula'

/** What a program is given for one run. */
export interface RunArgs {
  params: Record<string, number>
  tick: number
  /** The scene's seed, for `hash`. */
  seed: number
}

export interface ImageRequest {
  width: number
  height: number
  /** Which part of the grid to draw: left, top, right and bottom edges in cells (the whole grid is `[0, 0, width, height]`). */
  window: [number, number, number, number]
  /** Which layer of a 3D lattice (default 0). */
  layer?: number
  /** The color of anything not visible or outside the grid, each 0 to 1. */
  background?: [number, number, number]
}

/** The state of one lattice, held by a backend. */
export interface FormulaLattice {
  readonly cells: number
  /** Compile these programs now and say what is wrong with them (readable messages, or none). Nothing else needs to be called first. */
  check(programs: Program[]): Promise<string[]>
  /** Fill the state from a program that reads no state (`initFormula`). */
  init(program: Program, run: RunArgs): void
  /** One tick: every cell reads the old state, and the program's results become the new state. */
  step(program: Program, run: RunArgs): void
  /** Replace the state (after a restore, or an edit from outside). */
  upload(state: Record<string, ArrayLike<number>>): void
  /** The state, one value per cell for each field. */
  download(): Promise<Record<string, Float32Array>>
  /** The program's totals (`program.reduce`) over the current state. */
  totals(program: Program, run: RunArgs): Promise<Record<string, number>>
  /** A picture of the state: the program's `visible`, `r`, `g`, `b` for the cell under each pixel. RGBA, 4 bytes a pixel, row by row from the top. */
  image(program: Program, request: ImageRequest, run: RunArgs): Promise<Uint8Array>
  /** The look of every cell (3D lattices drawn as objects): the program's `visible`, `r`, `g`, `b` per cell, RGBA in grid order (x fastest, then y, then z); alpha is 255 where the cell is visible and 0 where it is not. */
  looks(program: Program, run: RunArgs): Promise<Uint8Array>
  dispose(): void
}

export interface FormulaBackend {
  readonly name: string
  /** A lattice of this shape; `fields` is the order the state is kept in. */
  lattice(grid: Grid, fields: string[]): FormulaLattice
}
