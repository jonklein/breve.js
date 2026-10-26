import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'
import { Picture, Sim, parseScene, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/vlm-scouts/', import.meta.url)
const loadExample = async () => {
  const p = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('scouts.js', dir).pathname).href)) as ScriptModule
  return { scene: p.ok ? p.scene : (null as never), script }
}

const small = (extra: object = {}) => {
  const r = parseScene(JSON.stringify({
    seed: 1, params: {}, bounds: { size: 30 },
    entities: [
      { name: 'scout', count: 1, color: '#ff0000', size: 2, sensors: [{ type: 'camera', name: 'view', size: 20, radius: 10 }], ...extra },
      { name: 'food', count: 1, color: '#00ff00', size: 2 },
    ],
    metrics: [],
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return r.ok ? r.scene : (null as never)
}

const place = (sim: Sim, set: number, x: number, z: number, vx = 0, vz = 0) => {
  const c = sim.worlds[set].table.cols as unknown as Record<string, Float32Array>
  c.px[0] = x; c.py[0] = 0; c.pz[0] = z; c.vx[0] = vx; c.vy[0] = 0; c.vz[0] = vz
}

test('a camera picture is egocentric: up is the way the agent heads, and others appear where they are', () => {
  let view: Picture | undefined
  const sim = new Sim(small(), { default: { decide: (obs: object) => { const v = (obs as { view?: Picture }).view; if (v) view = v; return {} } } })
  const mid = (p: Picture) => p.get(10, 10)
  const colorAt = (p: Picture, x: number, y: number) => p.get(x, y).join()

  // heading east, food 8 units east: straight ahead, so above the center
  place(sim, 0, 0, 0, 1, 0)
  place(sim, 1, 8, 0)
  sim.step()
  assert.ok(view instanceof Picture && view.width === 20 && view.height === 20)
  assert.deepEqual(mid(view!), [255, 255, 255], 'the agent itself is white at the center')
  assert.equal(colorAt(view!, 10, 2), '0,255,0', 'food 8 ahead of a range of 10 is near the top edge')

  // the same food is to the right of an agent heading north (up in the picture is north; its right is east)
  place(sim, 0, 0, 0, 0, -1)
  place(sim, 1, 8, 0)
  sim.step()
  assert.equal(colorAt(view!, 17, 10), '0,255,0', 'food to the east of a north-heading agent is on the right')

  // out of range: nothing but the dark background
  place(sim, 1, 25, 0)
  sim.step()
  assert.ok(![...view!.data].some((v, i) => i % 3 === 1 && v === 255 && view!.data[i - 1] === 0), 'no green pixel')

  // beyond the world's bounds is drawn darker (the world is 30 wide each side; stand at its edge)
  place(sim, 0, 29, 0, 1, 0)
  place(sim, 1, 0, 20)
  sim.step()
  assert.deepEqual(view!.get(10, 2), [52, 56, 64], 'ahead of an agent at the east wall is outside the world')
})

test('the picture is drawn only when a script reads it', () => {
  let reads = 0
  const sim = new Sim(small(), { default: { decide: (obs: object) => { void obs; reads++; return {} } } })
  sim.step()
  assert.equal(reads, 2) // both sets ran; neither touched `view`, and nothing failed
  assert.equal(sim.takeErrors().length, 0)
})

test('a camera sensor needs a name and a radius, and says so', () => {
  const bad = (sensor: object) => parseScene(JSON.stringify({ seed: 1, params: {}, bounds: { size: 5 }, entities: [{ name: 'a', count: 1, sensors: [sensor] }], metrics: [] }))
  assert.match((bad({ type: 'camera', radius: 5 }) as { errors: string[] }).errors.join(), /needs a name/)
  assert.match((bad({ type: 'camera', name: 'v' }) as { errors: string[] }).errors.join(), /radius/)
  assert.match((bad({ type: 'camera', name: 'v', radius: 5, via: 'r' }) as { errors: string[] }).errors.join(), /no "via"/)
  assert.match((bad({ type: 'neighbors', radius: 5, size: 8 }) as { errors: string[] }).errors.join(), /only a camera has a size/)
  assert.ok(bad({ type: 'camera', name: 'v', radius: 5, size: 16 }).ok)
})

test('think shows the camera picture to the model as PNG text, logs the answers, and replays without the model', async () => {
  const { scene, script } = await loadExample()
  const seen: { prompt: string; images: string[] | undefined }[] = []
  const sim = new Sim(scene, script)
  sim.provider = async (prompt, options) => { seen.push({ prompt, images: options?.images }); return JSON.stringify({ turn: 0.25, go: 1 }) }
  await sim.think()
  assert.equal(sim.takeErrors().length, 0, sim.takeErrors().join('\n'))
  assert.equal(seen.length, 4, 'one question per scout')
  for (const s of seen) {
    assert.equal(s.images?.length, 1)
    const png = Buffer.from(s.images![0], 'base64')
    assert.deepEqual([...png.subarray(0, 4)], [137, 80, 78, 71])
    assert.equal(png.readUInt32BE(16), 24, 'the picture is 24 pixels wide, as the scene asks')
    assert.equal(inflateSync(Buffer.concat([png.subarray(png.indexOf('IDAT') + 4, png.length - 16)])).length, 24 * (1 + 24 * 3))
  }
  assert.equal(sim.decisionLog.length, 4)
  for (let i = 0; i < 20; i++) sim.step()

  // run it again from the log with a model that must not be called
  const again = new Sim(scene, script)
  let calls = 0
  again.provider = async () => { calls++; return '{}' }
  again.replay(sim.decisionLog)
  await again.think()
  for (let i = 0; i < 20; i++) { await again.think(); again.step() }
  assert.equal(calls, 0)
  assert.equal(again.decisionLog.length, 4)
  assert.equal(again.hash(), sim.hash(), 'the replay reaches the same state')
})
