import type { Model, ModelDef } from '@breve/core'

/**
 * Trained models for simulations: ONNX files run with ONNX Runtime Web (WebAssembly on the CPU, or WebGPU where the browser
 * has it), found by path, URL or Hugging Face Hub name. The core knows only the `Model` shape; this package is the one place
 * that knows about a runtime, so a different one can replace it without touching the simulator.
 */

export interface LoadOptions {
  /** Where relative paths start (a URL ending in `/`, or a `file:` URL in Node). */
  base?: string
  /** Replace `fetch`, for tests or for a host with its own way to get files. */
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>
  /** Where downloaded files are kept so the next run does not fetch them again. Defaults to memory, plus the browser's Cache Storage when there is one. */
  cache?: ByteCache
  /** Where ONNX Runtime's WebAssembly files are served from (browser pages; Node finds its own). */
  wasmPaths?: string
}

export interface ByteCache {
  get(url: string): Promise<Uint8Array | undefined>
  put(url: string, bytes: Uint8Array): Promise<void>
}

/**
 * The real address of a model file. `hf:owner/repo/path/model.onnx` is a file on the Hugging Face Hub
 * (`hf:owner/repo@revision/path` pins a branch, tag or commit; the default is `main`).
 */
export function resolveUrl(url: string, base?: string): string {
  const hf = url.match(/^hf:([^/@]+)\/([^/@]+)(?:@([^/]+))?\/(.+)$/)
  if (hf) return `https://huggingface.co/${hf[1]}/${hf[2]}/resolve/${encodeURIComponent(hf[3] ?? 'main')}/${hf[4].split('/').map(encodeURIComponent).join('/')}`
  if (url.startsWith('hf:')) throw new Error(`"${url}" is not a Hugging Face file: write hf:owner/repo/path/to/model.onnx`)
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url
  return base ? new URL(url, base).href : url
}

const memory = new Map<string, Uint8Array>()

const defaultCache: ByteCache = {
  async get(url) {
    const hit = memory.get(url)
    if (hit) return hit
    if (typeof caches === 'undefined') return undefined
    try {
      const r = await (await caches.open('breve-models')).match(url)
      if (!r) return undefined
      const bytes = new Uint8Array(await r.arrayBuffer())
      memory.set(url, bytes)
      return bytes
    } catch {
      return undefined
    }
  },
  async put(url, bytes) {
    memory.set(url, bytes)
    if (typeof caches === 'undefined' || !/^https?:/.test(url)) return
    try { await (await caches.open('breve-models')).put(url, new Response(bytes as BodyInit)) } catch { /* storage full or blocked: the memory copy still works */ }
  },
}

async function fetchBytes(url: string, opts: LoadOptions): Promise<Uint8Array> {
  const cache = opts.cache ?? defaultCache
  const hit = await cache.get(url)
  if (hit) return hit
  let bytes: Uint8Array
  if (url.startsWith('file:') && !opts.fetch) {
    // Node only (a browser cannot read file: URLs): the specifier is not written out, so bundlers do not try to pull in node:fs
    const fsModule = 'node:fs/promises'
    const { readFile } = (await import(/* @vite-ignore */ fsModule)) as { readFile(url: URL): Promise<Uint8Array> }
    bytes = new Uint8Array(await readFile(new URL(url)))
  } else {
    const r = await (opts.fetch ?? ((u: string) => fetch(u)))(url)
    if (!r.ok) throw new Error(`could not download the model from ${url} (HTTP ${r.status})${url.includes('huggingface.co') && r.status === 401 ? ': this repository needs a login, which is not supported yet' : ''}`)
    bytes = new Uint8Array(await r.arrayBuffer())
  }
  await cache.put(url, bytes)
  return bytes
}

/** Load a model a scene declares under `models`. Rejects with a readable message when the file or the runtime fails. */
export async function loadModel(def: ModelDef, opts: LoadOptions = {}): Promise<Model> {
  const url = resolveUrl(def.url, opts.base)
  let bytes: Uint8Array
  try { bytes = await fetchBytes(url, opts) } catch (e) { throw new Error(e instanceof Error ? e.message : String(e)) }
  return onnxModel(bytes, def.device ?? 'cpu', opts, def.url)
}

/** Wrap ONNX bytes as a `Model`. A model with several inputs is not supported: it takes one tensor of shape [rows, width]. */
export async function onnxModel(bytes: Uint8Array, device: 'cpu' | 'webgpu' = 'cpu', opts: LoadOptions = {}, label = 'model'): Promise<Model> {
  const ort = await import('onnxruntime-web')
  // one thread: no SharedArrayBuffer (so no special page headers needed), and the same arithmetic order every run
  ort.env.wasm.numThreads = 1
  if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths
  let session
  try {
    session = await ort.InferenceSession.create(bytes, { executionProviders: device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'] })
  } catch (e) {
    throw new Error(`could not load "${label}" as an ONNX model: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (session.inputNames.length !== 1) throw new Error(`"${label}" has ${session.inputNames.length} inputs (${session.inputNames.join(', ')}); only models with one input tensor are supported`)
  const input = session.inputNames[0], output = session.outputNames[0]
  const dims = (session.inputMetadata as unknown as { name: string; shape?: (number | string)[] }[] | undefined)?.find((m) => m.name === input)?.shape
  const odims = (session.outputMetadata as unknown as { name: string; shape?: (number | string)[] }[] | undefined)?.find((m) => m.name === output)?.shape
  const fixed = (d?: (number | string)[]) => (d && d.length === 2 && typeof d[1] === 'number' && d[1] > 0 ? d[1] : undefined)
  return {
    inputWidth: fixed(dims),
    outputWidth: fixed(odims),
    deterministic: device === 'cpu',
    async run(data, rows) {
      if (rows <= 0) return new Float32Array(0)
      const width = data.length / rows
      const result = await session.run({ [input]: new ort.Tensor('float32', data, [rows, width]) })
      return Float32Array.from(result[output].data as Float32Array)
    },
  }
}

/**
 * Load every model the scene declares into `sim.models`. Relative paths start at `opts.base`. Resolves to the problems found
 * (one line per model that would not load), so a host can show them and carry on: a controller that needs a missing model
 * reports it by name the first time it asks.
 */
export async function loadSceneModels(sim: { scene: { models?: Record<string, ModelDef> }; models: Record<string, Model> }, opts: LoadOptions = {}): Promise<string[]> {
  const problems: string[] = []
  await Promise.all(Object.entries(sim.scene.models ?? {}).map(async ([name, def]) => {
    try { sim.models[name] = await loadModel(def, opts) } catch (e) { problems.push(`models.${name}: ${e instanceof Error ? e.message : String(e)}`) }
  }))
  return problems
}
