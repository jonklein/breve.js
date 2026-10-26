# Remote controllers: a model on the other end of a WebSocket

**Context.** People who train policies work in Python (NumPy, PyTorch, JAX). The simulator runs in a browser or in Node. M7's batched-model machinery (`thinkAll`, `ctx.model`, logged decisions) already lets a controller get actions from "something that maps rows of numbers to rows of numbers". The question was how to let a Python process be that something, without a second mechanism.

**Options.**
1. A new kind of controller for remote processes, with its own plumbing for logging, replay and flags.
2. A `Model` whose `run` talks to another process. The scene names it like any model: `"models": { "policy": { "url": "ws://localhost:8765" } }`.
3. Make the simulator a server that a Python trainer steps like a Gym environment.

**Decision.** Option 2. `@breve/inference` handles `ws://` and `wss://` addresses with `remoteModel`. The protocol is deliberately tiny so any language can speak it: the simulator sends one binary message per call, `uint32 rows`, `uint32 width`, then `rows * width` float32 (little-endian); the server replies with one binary message in the same layout (rows, output width, values). One call is in flight at a time. Browser pages use the browser's `WebSocket` (also available in workers); Node 22 has it built in.
- The remote model reports `deterministic: false`, so the sets that use it are flagged "not repeatable". Because answers are logged as decisions, a run can still be saved and replayed with no server running.
- A trainer sees every observation, so it can keep any state, and a script that wants the trainer to see a reward just adds it to each observation row (more numbers per row). Nothing about learning is built into the simulator.
- `examples/remote-policy/serve.py` is a complete server (about 20 lines of logic, NumPy and `websockets`); it gives the same results as the ONNX example. It is kept out of the gallery because it needs the server running.
- Closing: `Model.dispose` closes the socket when the sim is disposed (the workbench rebuilds sims often).

**Not done.** Option 3 (a trainer stepping the simulator) is a different shape: the trainer owns the clock. It could be added as a host mode later, using the same snapshots and fork. Authentication and `wss://` certificates are the host's business (browsers allow `ws://localhost` from an `https` page; anything else needs `wss://`).

**Consequences.** `ws://` URLs in a scene reach out from the page, which is another reason a project from a share link is held until approved. The workbench shows a clear message when it cannot connect ("is the server running?").
