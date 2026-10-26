# Running trained models (ONNX) in simulations

**Context.** M7 asks for neural controllers from trained models: ONNX with WebGPU where available, batched inference for a whole population, and models loaded from the Hugging Face Hub. The core must stay headless and small (no ML runtime in it), simulations must stay deterministic where they can be, and a run that used a model should still replay without it.

**Options.**
1. Run the model synchronously inside `decide`. ONNX Runtime Web has no synchronous API, so this is impossible in the browser.
2. Treat a model call as a kind of `think`: asynchronous, batched, and its answers logged as decisions. The simulator already has this machinery for language models (lockstep or realtime, decision log, exact replay).
3. Make the whole tick asynchronous. Too invasive, and it would make every simulation pay for what only some need.

**Decision.** Option 2.
- `packages/core` defines only the `Model` interface (rows of numbers in, rows out; `deterministic` says whether the math can differ between runs) and `ctx.model(name)`, which hands a script a `ModelHandle` (`run`, `runBatch`). `sim.models` is a plain registry the host fills.
- A controller may export `thinkAll(agents, params, ctx)`: one call for every due entity of its set, so `ctx.model('policy').runBatch(...)` is one inference for the whole crowd. It returns one decision per entity; each is logged and read as `self.decision`, exactly like `think`. Replaying a log needs no model and no runtime (tested). `think: { every: 1 }` makes it run every tick; lockstep mode waits for it.
- The scene declares models under `models` (`{ url, device }`), validated by the scene schema. The host loads them.
- `packages/inference` (`@breve/inference`) is the one place that knows ONNX Runtime Web: `loadModel`, `loadSceneModels`, address resolution (`hf:owner/repo[@rev]/path` becomes a Hub URL; paths resolve against the example's folder), and a byte cache (memory plus the browser's Cache Storage). It uses the WebAssembly backend with one thread, so no special page headers are needed and results do not depend on thread scheduling. `device: "webgpu"` tries WebGPU first and falls back to WebAssembly; such a model reports `deterministic: false`, which flags the sets that use it as not repeatable.
- Dependency: `onnxruntime-web` (MIT, Microsoft, the standard browser runtime). Its WebAssembly file is about 28 MB and is fetched only when a scene declares models; nothing else on the site pays for it.
- A decision log is capped (250,000 entries, newest kept) so a model deciding every tick cannot fill memory; past the cap the log is marked incomplete and cannot replay the run from the start.
- Sets are flagged "not repeatable" only when a controller asked a language model, declared itself non-deterministic, or uses a non-deterministic model. A CPU model is repeatable.

**Not done, and why.** WebGPU execution is written but untested here (no GPU in the test environment). Models with several inputs are rejected with a clear message. Hub repositories that need a login are not supported. Experiments (`@breve/experiment`) step simulations without `think`, so a search over a scene that depends on a model is not supported yet.

**Consequences.** A model is an asset the scene names, not code in the simulator, so swapping a network is a one-line edit. Models must take one input tensor `[batch, width]` and give `[batch, width]`. The example is `examples/onnx-policy`, with `make_policy.py` showing how the file is made.
