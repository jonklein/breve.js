import { Sim } from './sim'
import { withParams, type Params, type Scene } from './scene'
import type { Message, ScriptModule } from './world'

/** A message as the parent saw it, with the sim it came from or went to. */
export interface LoggedMessage extends Message {
  sim: string
  direction: 'up' | 'down'
}

/** What a parent does when a sim sends it something. It may answer with `group.send`, or change the group. */
export type ParentHandler = (msg: Message & { sim: string }, group: SimGroup) => void

/**
 * Many sims run side by side: a parameter sweep, a set of forks, islands that trade. The group is the
 * parent of its sims. Sims never address each other: a sim sends to the group, and the group's
 * `parent` handler decides what to do about it. Every message is logged, so a run can be replayed
 * without the parent's logic.
 */
export class SimGroup {
  readonly sims = new Map<string, Sim>()
  readonly log: LoggedMessage[] = []
  parent: ParentHandler | null = null

  add(name: string, sim: Sim): Sim {
    if (this.sims.has(name)) throw new Error(`the group already has a sim called "${name}"`)
    this.sims.set(name, sim)
    return sim
  }

  get(name: string): Sim {
    const s = this.sims.get(name)
    if (!s) throw new Error(`no sim called "${name}" (have: ${[...this.sims.keys()].join(', ')})`)
    return s
  }

  /** Copy a sim from where it is now, optionally with some params changed. */
  fork(from: string, name: string, params?: Params): Sim {
    const src = this.get(from)
    return this.add(name, src.fork(params ? withParams(src.scene, params) : undefined))
  }

  remove(name: string): void {
    this.sims.get(name)?.dispose()
    this.sims.delete(name)
  }

  /**
   * The same scene started once per value of one param: `await SimGroup.sweep(scene, script, 'separation', [0, 5, 10])`.
   * Every sim keeps the scene's seed, so differences are down to the param alone.
   */
  static async sweep(scene: Scene, script: ScriptModule | undefined, param: string, values: number[]): Promise<SimGroup> {
    const g = new SimGroup()
    for (const v of values) g.add(`${param}=${v}`, await Sim.create(withParams(scene, { [param]: v }), script))
    return g
  }

  /** Send the parent's message to one sim; it arrives at the start of that sim's next tick. */
  send(name: string, topic: string, data?: unknown): void {
    const s = this.get(name)
    s.deliver(topic, data)
    this.log.push({ sim: name, direction: 'down', topic, data, tick: s.tick })
  }

  /** Advance every sim one tick, then hand what they sent to the parent in the order the sims were added. */
  step(): void {
    for (const s of this.sims.values()) s.step()
    for (const [name, s] of this.sims) {
      for (const m of s.takeOutbox()) {
        this.log.push({ sim: name, direction: 'up', ...m })
        this.parent?.({ sim: name, ...m }, this)
      }
    }
  }

  /** Every sim's metrics, by sim name. */
  metrics(): Record<string, Record<string, number>> {
    return Object.fromEntries([...this.sims].map(([name, s]) => [name, s.metrics()]))
  }

  hash(): string {
    return [...this.sims].map(([n, s]) => `${n}:${s.hash()}`).join('|')
  }

  dispose(): void {
    for (const s of this.sims.values()) s.dispose()
    this.sims.clear()
  }
}
