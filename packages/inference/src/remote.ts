import type { Model } from '@breve/core'

export interface RemoteOptions {
  /** How long to wait for the connection to open, in milliseconds. Default 5000. */
  connectTimeout?: number
  /** How long to wait for each answer, in milliseconds. Default 15000. */
  answerTimeout?: number
}

/**
 * A model that lives in another process (a Python trainer, a policy server): `ws://host:port`. Each call sends one binary
 * message, `rows` and `width` as little-endian uint32 followed by rows × width little-endian float32, and waits for one
 * binary reply in the same layout (rows, output width, values). One call is in flight at a time. The simulator cannot know
 * what the other end does, so the model reports `deterministic: false`; its answers are logged as decisions like any other,
 * so a run can still be replayed with no server at all. See docs/decisions/remote.md and examples/remote-policy/serve.py.
 */
export async function remoteModel(url: string, opts: RemoteOptions = {}): Promise<Model> {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`could not connect to ${url} within ${(opts.connectTimeout ?? 5000) / 1000} s: is the server running?`)); ws.close() }, opts.connectTimeout ?? 5000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`could not connect to ${url}: is the server running?`)) }, { once: true })
  })

  let waiting: { resolve(buf: ArrayBuffer): void; reject(e: Error): void } | null = null
  let closed: Error | null = null
  ws.addEventListener('message', (ev) => {
    const w = waiting
    waiting = null
    if (!w) return
    if (ev.data instanceof ArrayBuffer) w.resolve(ev.data)
    else w.reject(new Error(`${url} answered with text; it must answer with a binary message (see docs/decisions/remote.md)`))
  })
  ws.addEventListener('close', () => {
    closed = new Error(`the connection to ${url} closed`)
    waiting?.reject(closed)
    waiting = null
  })

  let queue: Promise<unknown> = Promise.resolve()
  return {
    deterministic: false,
    dispose() { ws.close() },
    run(input, rows) {
      const call = async (): Promise<Float32Array> => {
        if (closed) throw closed
        const width = rows ? input.length / rows : 0
        const msg = new ArrayBuffer(8 + input.byteLength)
        const view = new DataView(msg)
        view.setUint32(0, rows, true)
        view.setUint32(4, width, true)
        new Float32Array(msg, 8).set(input) // typed arrays are little-endian on every platform a browser or Node runs on
        const answer = new Promise<ArrayBuffer>((resolve, reject) => {
          waiting = { resolve, reject }
          setTimeout(() => { if (waiting?.resolve === resolve) { waiting = null; reject(new Error(`${url} did not answer within ${(opts.answerTimeout ?? 15000) / 1000} s`)) } }, opts.answerTimeout ?? 15000)
        })
        ws.send(msg)
        const reply = await answer
        if (reply.byteLength < 8) throw new Error(`${url} sent a reply of ${reply.byteLength} bytes; it needs at least the 8-byte header`)
        const head = new DataView(reply)
        const n = head.getUint32(0, true), w = head.getUint32(4, true)
        if (n !== rows) throw new Error(`${url} answered ${n} rows to a request of ${rows}`)
        if (reply.byteLength !== 8 + n * w * 4) throw new Error(`${url} sent ${reply.byteLength - 8} bytes of values for ${n} rows of ${w} numbers (expected ${n * w * 4})`)
        return new Float32Array(reply.slice(8))
      }
      const result = queue.then(call, call)
      queue = result.catch(() => undefined)
      return result
    },
  }
}
