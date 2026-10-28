/** The physics settings a scene gets when it does not say. Every one can be set in the scene's `physics` block (or the terrain's, or a part's own). */
export interface PhysicsDefaults {
  /** Meters per second squared, pulling down. */
  gravity: number
  /** Physics steps per tick. */
  substeps: number
  /** How strongly every body is slowed just for moving (per second, as a fraction of its speed). 0 is none. */
  linearDamping: number
  /** The same for spinning. */
  angularDamping: number
  /** Friction of the ground. A part's own `friction` sets its side of the contact. */
  friction: number
  /** How bouncy contacts are, 0 (dead) to 1 (perfect). */
  restitution: number
  /** Iterations of the contact and joint solver per step: more is stiffer and slower. */
  solverIterations: number
  /** Whether a body that has stopped moving may be put to sleep. Off, a resting creature still responds the instant a script pushes it. */
  sleep: boolean
  /** Where creatures start when a set gives no `spawn`: scattered over this fraction of the terrain's width, centered. */
  spawnArea: number
  /** Creatures bump into each other (never into their own parts). */
  collide: boolean
  /** A floor on how hard each part is to spin: its rotational inertia is at least mass times this many metres squared. 0 is off. */
  minGyration: number
  /** Meters above the highest ground under a creature that a new body is dropped from, so no foot starts buried. */
  spawnLift: number
}

/** The most the engine will make from a `count` before it says so. Raise them in the scene's `limits` when the machine can take it. */
export interface LimitDefaults {
  creatures: number
  agents: number
  nodes: number
}

/** How a scene's time works when it does not say. */
export interface TimeDefaults {
  /** How much simulated time `T` one step advances. 1/60 is a sixtieth of a second for a physical scene; abstract scenes (a generation of Life) usually say 1. */
  step: number
  /** How much simulated time to try to run per real second: `"max"` runs as fast as the machine allows. */
  pace: number | 'max'
  /** How many times a second the picture is updated: the display's rate, never more than needed. */
  fps: number
  /** What `T` is measured in, for labels. */
  unit: string
}

/**
 * The assumptions a scene makes when it says nothing, gathered in one place so none is hidden in the engine. The engine reads a
 * setting from the scene first and falls back to these; to change a default for one scene, set it there. Nothing else in the engine
 * has a built-in preference about physics, spawning, limits or where a rule runs.
 */
export class Defaults {
  /** Physics: see `PhysicsDefaults`. These are the values every creature scene has had so far. */
  static readonly physics: PhysicsDefaults = {
    gravity: 9.81,
    substeps: 4,
    linearDamping: 0.05,
    angularDamping: 0.3,
    friction: 1,
    restitution: 0,
    solverIterations: 8,
    sleep: false,
    spawnLift: 0.05,
    spawnArea: 0.6,
    collide: true,
    minGyration: 0,
  }

  /** Limits on how many of each thing a `count` may ask for. */
  static readonly limits: LimitDefaults = { creatures: 200, agents: 5000, nodes: 100000 }

  /** Time: see `TimeDefaults`. */
  static readonly time: TimeDefaults = { step: 1 / 60, pace: 'max', fps: 60, unit: 's' }

  /** Where a formula lattice runs when its `compute` is not given: `auto` is the graphics card when the host has one and the processor otherwise. */
  static readonly compute: 'auto' | 'cpu' | 'gpu' = 'auto'
}
