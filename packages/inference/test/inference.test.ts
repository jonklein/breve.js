import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handleFor, Sim, parseScene, type ScriptModule } from '@breve/core'
import { loadModel, resolveUrl, onnxModel, type ByteCache } from '../src/index'

const fixtures = new URL('../fixtures/', import.meta.url)
const bytes = () => new Uint8Array(readFileSync(new URL('policy.onnx', fixtures)))
const near = (a: ArrayLike<number>, b: number[], eps = 1e-5) => b.forEach((v, i) => assert.ok(Math.abs(a[i] - v) < eps, `${Array.from(a)} vs ${b}`))

test('addresses: Hugging Face names, full URLs and relative paths', () => {
  assert.equal(resolveUrl('hf:acme/walker/policy.onnx'), 'https://huggingface.co/acme/walker/resolve/main/policy.onnx')
  assert.equal(resolveUrl('hf:acme/walker@v2/onnx/model one.onnx'), 'https://huggingface.co/acme/walker/resolve/v2/onnx/model%20one.onnx')
  assert.equal(resolveUrl('https://example.com/m.onnx'), 'https://example.com/m.onnx')
  assert.equal(resolveUrl('policy.onnx', 'http://localhost:5173/neural/'), 'http://localhost:5173/neural/policy.onnx')
  assert.throws(() => resolveUrl('hf:justaname'), /write hf:owner\/repo\/path/)
})

test('an ONNX file runs in batches and matches numpy', async () => {
  const model = await onnxModel(bytes())
  assert.equal(model.deterministic, true)
  assert.equal(model.inputWidth, 4)
  assert.equal(model.outputWidth, 2)
  // tanh(x W + b) for three rows, worked out with numpy when the fixture was made
  const out = await model.run(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1]), 3)
  near(out, [0.537, -0.3364, 0.1974, 0.1974, 0.3364, 0.1974], 1e-3)
  assert.equal((await model.run(new Float32Array(0), 0)).length, 0)
  // through the handle a script sees: arrays in, arrays out, and a clear error for the wrong width
  const h = handleFor('policy', model)
  near(await h.run([1, 0, 0, 0]), [0.537, -0.3364], 1e-3)
  assert.equal((await h.runBatch([[1, 0, 0, 0], [0, 1, 0, 0]])).length, 2)
  await assert.rejects(h.run([1, 2]), /takes 4 numbers per observation, got 2/)
})

test('loadModel reads a path or a Hub name, caches the bytes, and says plainly what went wrong', async () => {
  const stored = new Map<string, Uint8Array>()
  const cache: ByteCache = { get: async (u) => stored.get(u), put: async (u, b) => void stored.set(u, b) }
  const asked: string[] = []
  const fetchStub = async (url: string) => { asked.push(url); return url.includes('missing') ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } : { ok: true, status: 200, arrayBuffer: async () => bytes().buffer as ArrayBuffer } }
  const m1 = await loadModel({ url: 'hf:acme/walker/policy.onnx' }, { fetch: fetchStub, cache })
  await loadModel({ url: 'hf:acme/walker/policy.onnx' }, { fetch: fetchStub, cache })
  assert.deepEqual(asked, ['https://huggingface.co/acme/walker/resolve/main/policy.onnx'], 'the second load comes from the cache')
  assert.equal(m1.inputWidth, 4)
  const local = await loadModel({ url: 'policy.onnx' }, { base: fixtures.href, cache })
  assert.equal(local.outputWidth, 2)
  await assert.rejects(loadModel({ url: 'hf:acme/missing/x.onnx' }, { fetch: fetchStub, cache }), /could not download the model from https:\/\/huggingface.co\/acme\/missing.*404/)
  await assert.rejects(onnxModel(new Uint8Array([1, 2, 3]), 'cpu', {}, 'junk.onnx'), /could not load "junk.onnx" as an ONNX model/)
})

test('a simulation steered by an ONNX policy: one batched call a tick, and the run replays without the runtime', async () => {
  const scene = parseScene(JSON.stringify({
    seed: 5, params: {}, bounds: { size: 20, mode: 'clamp' }, models: { policy: { url: 'policy.onnx' } },
    entities: [{ name: 'a', count: 8, think: { every: 1 }, motion: { maxSpeed: 6, plane: 'xz' } }], metrics: [],
  }))
  assert.ok(scene.ok)
  const script: ScriptModule = {
    default: {
      init: () => ({ dx: 0, dz: 0 }),
      thinkAll: async (obs, _p, ctx) => (await ctx.model('policy').runBatch(obs.map(({ self }) => [self.x / 20, self.z / 20, self.vx / 6, self.vz / 6]))).map(([dx, dz]) => ({ dx, dz })),
      act: ({ self }) => ({ steer: [self.dx * 12, 0, self.dz * 12] }),
    },
  }
  const sim = new Sim(scene.ok ? scene.scene : (null as never), script)
  let calls = 0
  const real = await loadModel({ url: 'policy.onnx' }, { base: fixtures.href })
  sim.models.policy = { ...real, run: (i, n) => { calls++; return real.run(i, n) } }
  for (let t = 0; t < 30; t++) { await sim.think(); sim.step() }
  assert.equal(sim.takeErrors().length, 0, sim.takeErrors().join('\n'))
  assert.equal(calls, 30, 'one call a tick for all eight agents')
  assert.equal(sim.decisionLog.length, 240)
  const again = new Sim(scene.ok ? scene.scene : (null as never), script)
  again.replay(sim.decisionLog)
  for (let t = 0; t < 30; t++) { await again.think(); again.step() }
  assert.equal(again.hash(), sim.hash(), 'replay reaches the same state with no model loaded')
})

test('a remote model: a process on a WebSocket answers batches, and the simulation still replays without it', async () => {
  const { WebSocketServer } = await import('ws')
  const { remoteModel } = await import('../src/index')
  const asked: { rows: number; width: number }[] = []
  const server = new WebSocketServer({ port: 0 })
  await new Promise<void>((r) => server.on('listening', () => r()))
  const port = (server.address() as { port: number }).port
  // the "trainer": answers each row with [sum of its numbers, number of numbers]
  server.on('connection', (sock) => sock.on('message', (data: Buffer) => {
    const rows = data.readUInt32LE(0), width = data.readUInt32LE(4)
    asked.push({ rows, width })
    const out = Buffer.alloc(8 + rows * 2 * 4)
    out.writeUInt32LE(rows, 0); out.writeUInt32LE(2, 4)
    for (let r = 0; r < rows; r++) {
      let s = 0
      for (let k = 0; k < width; k++) s += data.readFloatLE(8 + (r * width + k) * 4)
      out.writeFloatLE(s, 8 + r * 8); out.writeFloatLE(width, 8 + r * 8 + 4)
    }
    sock.send(out)
  }))
  try {
    const model = await loadModel({ url: `ws://127.0.0.1:${port}` })
    assert.equal(model.deterministic, false)
    const out = await model.run(Float32Array.from([1, 2, 3, 4, 5, 6]), 2)
    assert.deepEqual(Array.from(out), [6, 3, 15, 3])
    // two calls at once are sent one after the other, each getting its own answer
    const [a, b] = await Promise.all([model.run(Float32Array.from([1, 1]), 1), model.run(Float32Array.from([2, 2, 2]), 1)])
    assert.deepEqual([Array.from(a), Array.from(b)], [[2, 2], [6, 3]])
    assert.deepEqual(asked, [{ rows: 2, width: 3 }, { rows: 1, width: 2 }, { rows: 1, width: 3 }])
    // when the server goes away, the next call says so
    for (const c of server.clients) c.close()
    await new Promise((r) => setTimeout(r, 100))
    await assert.rejects(model.run(Float32Array.from([1]), 1), /closed/)
  } finally {
    server.close()
  }
  await assert.rejects(loadModel({ url: 'ws://127.0.0.1:1' }), /could not connect to ws:\/\/127.0.0.1:1.*is the server running/)
})
