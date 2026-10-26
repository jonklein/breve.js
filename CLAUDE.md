# CLAUDE.md

Instructions for Claude Code working on this repository. Read `SPEC.md` and `MILESTONES.md` first. They are the source of truth for design and scope.

## How to work

- Work on **one milestone at a time**, in order. Do not build ahead.
- Within a milestone, write the **acceptance test first** (or alongside), then the implementation. A milestone is not done until its demo and tests pass.
- If the spec is ambiguous or wrong, update the spec in the same change and say so in the commit message. Do not silently diverge.
- Prefer small, reviewable changes. One concern per commit.
- When a decision is made that the spec leaves open, record it in `docs/decisions/<topic>.md` (context, options, decision, consequences).

## Non-negotiable rules

1. **Determinism.** No `Math.random()`, `Date.now()` or iteration-order dependence in sim code. All randomness comes from the sim's seeded RNG. Add a test that runs a scene twice and compares column bytes.
2. **Headless core.** The sim core package must not import the DOM, Three.js, or any renderer. Enforce with a lint rule or dependency check.
3. **Columnar state.** Entity state lives in typed-array columns per `SPEC.md` section 4. Do not store behavior-affecting state in ad hoc JS objects. Object columns are an explicit, flagged escape hatch.
4. **Snapshot-able or flagged.** Anything affecting behavior is in snapshot-able storage, or its controller declares itself non-deterministic. Never silently break fork or replay.
5. **Schema everywhere.** Every data format (scene, body, controller spec, experiment) has a JSON Schema and validation with readable error messages. Add schema tests with valid and invalid fixtures.
6. **Do not write a physics engine, renderer, ML runtime or graph layout library.** Use off-the-shelf libraries behind thin adapter interfaces.
7. **Sim is a value.** No module-level mutable world state. Everything hangs off a `Sim` instance.
8. **Parent-mediated messaging.** Sims never address siblings directly.

## Design preferences

- User-facing APIs must read well in a short script. If a common task takes more than a few lines, the API is wrong; fix the API or add a default.
- **Sensible defaults for everything.** A scene with almost nothing in it should run, render and be inspectable.
- Handles (readable) and raw columns (fast) are both first-class. Hot loops use columns; user scripts use handles.
- Evolution and any other search strategy belong in example libraries implementing the `Strategy` interface, not in the core. Do not add evolution-specific concepts to the core.
- Keep the core small. If something can be a controller, a system, or a strategy, it is not core.

## Testing

- Unit tests for storage, schemas, handles, clocks and RNG.
- **Determinism tests** for every milestone's demo scene.
- **Fork tests:** fork mid-run, advance both branches with identical inputs, assert identical state.
- **Performance budgets** as tests where the milestone states a number (for example the 1000×1000 lattice). Record results in `docs/perf.md`.
- Demo scenes live in `examples/` and double as integration tests that run headless.

## Repository layout (proposed)

```
packages/
  server/        local API server for the LLM assistant (holds the API key, never the browser)
  core/          sim kernel: storage, clock, scenes, Sim, no DOM
  stdlib/        the standard library scripts use (Vec3, Vecs, Nums, Agents, Field, Mlp): no engine code, no DOM; docs/stdlib.md is generated from its comments (`npm run docs`)
  render/        renderer reading world state
  physics-*/     optional physics engines, one package each (physics-mujoco); the default, Rapier, lives in packages/core/src/physics/ behind the same adapter interface, loaded lazily. The core never imports an optional engine: hosts register it (`registerPhysicsEngine`)
  controllers/   built-in controllers
  experiment/    Strategy interface and runners, plus mutate/crossover helpers for hand-written searches
  inference/     the only package that knows ONNX Runtime Web: loads models (path, URL or hf:owner/repo/file) into sim.models (docs/decisions/inference.md)
  view/          Three.js drawing of a world (agents, cells, graphs, creatures), shared by the workbench and the embed
  embed/         `breve.run(selector, script, config)` for other web pages, built with esbuild (docs/decisions/embed.md)
  workbench/     the site: home (/), workbench (/sim/), gallery, about; one HTML file per page (docs/decisions/site.md)
examples/        demo scenes and scripts
docs/decisions/  decision records
docs/perf.md     benchmark results
```

Adjust if there is a good reason, and update this file when you do.

## Tooling defaults

TypeScript, ES modules, a monorepo with workspaces.

- Core packages (no DOM) are plain TypeScript built with `tsc`. No bundler.
- Tests use `node:test` with `tsx`. Switching to Vitest needs a decision record.
- **Vite is used only by the workbench package** (dev server, workers, WASM, production bundle). Keep it boring:
  - Workers use the standard `new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })`. No `?worker`.
  - No `?url`, `?raw` or other special import suffixes, and no `import.meta.env`.
  - No Vite plugins beyond the minimum; adding one needs a decision record.
  - Keep `vite.config.ts` under about 30 lines with no logic in it.
- Change any of this only with a decision record.

## Style

- Match existing code in naming, comment density and idiom.
- Comments explain why, not what.
- No dependencies without a sentence of justification in the PR or commit message. Prefer well-maintained libraries with permissive licenses.

## Things to ask the human about

- Anything touching naming, branding or public positioning.
- Adding a paid or hosted service dependency.
- Changing a "non-negotiable rule" above.

## The assistant (LLM) integration

- The Anthropic key lives only in `.env` (git-ignored) and is read by `packages/server`. Never send it to, or read it from, the browser, and never print or commit it.
- Keep `docs/script-api.md` accurate (and regenerate `docs/stdlib.md` with `npm run docs` when stdlib comments change; a test checks it): it is the assistant's reference. When scene fields or script APIs change, update it in the same change; the server tests check that examples validate.
- Model calls use the official SDK, adaptive thinking, and streaming. The default model is `claude-opus-5-5` unless `BREVE_MODEL` says otherwise.
