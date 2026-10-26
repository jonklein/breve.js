import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { Picture } from '../src/index'

/** Read a PNG back with Node's own zlib, so the test does not trust the encoder to check itself. */
function decode(png: Uint8Array) {
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(png.buffer, png.byteOffset)
  let at = 8
  let w = 0, h = 0
  const idat: Buffer[] = []
  while (at < png.length) {
    const len = view.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    const body = png.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') { w = new DataView(body.buffer, body.byteOffset).getUint32(0); h = new DataView(body.buffer, body.byteOffset).getUint32(4) }
    if (type === 'IDAT') idat.push(Buffer.from(body))
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  return { w, h, raw }
}

test('an Picture encodes to a PNG that a real decoder reads back pixel for pixel', () => {
  const img = new Picture(5, 3, [10, 20, 30])
  img.set(1, 1, [255, 0, 0])
  img.set(4, 2, [0, 255, 0])
  img.set(9, 9, [1, 1, 1]) // off the picture: ignored
  const { w, h, raw } = decode(img.toPng())
  assert.deepEqual([w, h], [5, 3])
  const px = (x: number, y: number) => Array.from(raw.subarray(y * 16 + 1 + x * 3, y * 16 + 1 + x * 3 + 3))
  assert.deepEqual(px(0, 0), [10, 20, 30])
  assert.deepEqual(px(1, 1), [255, 0, 0])
  assert.deepEqual(px(4, 2), [0, 255, 0])
})

test('a picture bigger than one stored block still decodes (and the base64 form is plain text)', () => {
  const img = new Picture(200, 150, [1, 2, 3]) // 90,150 bytes of pixels: two blocks
  img.dot(100, 75, 20, [200, 100, 50])
  const { w, h, raw } = decode(img.toPng())
  assert.deepEqual([w, h, raw.length], [200, 150, 150 * (1 + 600)])
  assert.deepEqual(Array.from(raw.subarray(75 * 601 + 1 + 100 * 3, 75 * 601 + 1 + 100 * 3 + 3)), [200, 100, 50])
  assert.match(img.toBase64(), /^iVBORw0KGgo[A-Za-z0-9+/]+=*$/)
})
