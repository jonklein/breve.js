# breve (next generation)

A browser-based platform for building and tinkering with multi-agent simulated worlds — a modern take on the original [breve simulation environment](http://github.com/jonklein/breve), in the lineage of StarLogo, Karl Sims' creatures, and Polyworld.

Not a port. The goals carry over; the decisions don't.

## The idea in one paragraph

A world is entities with components and relations. 3D continuous space is the default, but a lattice of patches, a network, and an economy are the same model with different neighbor sources. Structure (worlds, bodies, experiments) is JSON that people and LLMs can safely edit. Behavior is JavaScript or a learned model attached as a pluggable controller. Many simulations at once, forks, and parameter sweeps are normal. Evolution is one search strategy among many, not a built-in.

## Documents

- [SPEC.md](SPEC.md): design spec (world model, storage, controllers, Sim, experiments, rendering).
- [MILESTONES.md](MILESTONES.md): ordered build plan with acceptance demos.
- [docs/script-api.md](docs/script-api.md): reference for scenes and scripts (also what the assistant is given).
- [CLAUDE.md](CLAUDE.md): conventions for Claude Code working on this repo.
- `docs/decisions/`: decision records (created as decisions are made).

## Running it

```bash
npm install
npm run dev     # site at http://localhost:5173 (the workbench is at /sim/), plus the local API server
npm test        # core and server tests
npm run typecheck
```

### The assistant (LLM)

The workbench records the run as it goes: the **Timeline** slider under the view goes back to an earlier moment and pauses there, and Play carries on from it as a new branch. **Tree view** (above the editor) edits `scene.json` and `experiment.json` as a tree of fields over the same text, and **Share** copies a link that carries the whole project.

The workbench has an **Assistant** tab: describe a change in words, review the proposed diff, and apply or dismiss it (with undo). It needs an Anthropic API key. Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. The key stays on the local API server (`packages/server`, bound to 127.0.0.1) and never reaches the browser. The model defaults to `claude-opus-5-5`; set `BREVE_MODEL` to change it. The assistant is given [docs/script-api.md](docs/script-api.md) and the example projects, and its proposals are validated against the scene schema and checked for script syntax (with automatic repair attempts) before you see them.

## Status

Playable and growing: 3D boids and 3D Life in the browser, editable scene and script with hot reload, example switching and forking, and an LLM assistant. There is now a first physics example too: four-legged creatures with a JSON body, motors and an oscillator, walking on Perlin-noise terrain (Rapier, see [docs/decisions/physics.md](docs/decisions/physics.md)). Next up is the rest of the bodies-and-physics milestone (importers, snapshots, mutation utilities). The plan is in [MILESTONES.md](MILESTONES.md).
