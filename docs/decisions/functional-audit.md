# Audit: are the simulations written in a functional style?

**Status:** findings, no code changed. Scope: every script in `examples/` and the script-facing API in `docs/script-api.md`.

**What "functional" means here.** A hook is a function of what it is given: `act(obs, params, ctx)` returns what should change and does not reach out and change it. The engine applies results at the end of the tick, so every entity reads the old state. That keeps runs replayable, forkable and, for whole-set rules, compilable.

## What is already good

- **Agent, lattice and network scripts return, they do not mutate.** A grep for assignments to `self`, `state`, `fields`, `obs` or `ctx` finds none in any example. Results are `steer`, `place`, `state`, `add`, `exchange`, `joints`, plain objects. `place` now follows the same rule (the change we just made).
- **Declarative effects.** `exchange: [{ with, give, get }]` and `add: { scent }` say what should happen; the engine makes it atomic or sums it. This is the right shape for anything that touches another entity.
- **`Field` is immutable and lazy**: every operation returns a new field, and a chain is worked out once in blocks. `life2d` is already a pure array program.
- **Vectors are values** (`plus`, `times`, `reversed` return new ones). Genome helpers (`crossover`, `mutate`) clone first and return the copy.
- **Display and metrics are pure reads.**

## What is not, in order of how much it matters

1. **Randomness is a hidden mutable stream.** `ctx.random()` and `host.random()` advance seeded state behind the call, so the result of a rule depends on how many times, and in what order, other entities called it. Replays are exact only because the engine fixes the iteration order. It also rules out running cells in parallel or on a GPU. A pure alternative is counter-based: `ctx.hash(self.id, salt)` (a function of the tick, the entity and a name you give it, nothing else). Same quality of randomness, no shared state, same answer in any order. This is also what the GPU path needs, so the proposal is to add it there first (`gpu-fields.md`).
2. **Parent scripts (`neural/brain.js`, `evolved-creatures/creatures.js`) are imperative.** They keep a mutable `run` object in a `WeakMap` and change it with `run.tickInGen++`, `run.gen++`, and they call `host.add` and `host.remove` as they go. They are the only scripts in the repository that behave like this. A functional shape would be `step(state, host) -> { state, commands }`: the parent returns its next state and a list of commands (`add`, `remove`), and the host performs them. That gives parents the same replay and snapshot story as everything else, and makes them testable without a host. It is a larger change to a public hook, so it needs your go-ahead.
3. **`ctx.tick`, `ctx.input.pressed(...)`, `self.patchAt(...)`, `nests.nearest()`** read the world rather than receive it as an argument. They are reads, not writes, and they are deterministic, so this is acceptable; the cost is that a script's real inputs are not all visible in its signature. Low priority.
4. **Loops that fill local arrays** (`initAll` in `epidemic/contagion.js`, the shuffle there) mutate arrays they created. Harmless: nothing escapes. Not worth changing.

## Recommendations

- Add a pure, counter-based random (`ctx.hash`) and use it where order does not matter. Keep `ctx.random()` for readability in per-entity rules. (Part of the GPU plan.)
- Leave parents as they are until we decide on a `{ state, commands }` shape; it is worth doing, and best done together with parallel sub-sims on workers, which needs the same property.
- No change needed for the agent, lattice and network scripts.
