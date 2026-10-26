/** A small RGB picture: what a camera sensor produces, and what a vision model is shown. */
export class Picture {
  readonly data: Uint8Array
  constructor(readonly width: number, readonly height: number, fill: [number, number, number] = [0, 0, 0]) {
    this.data = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i++) this.data.set(fill, i * 3)
  }

  /** Paint one pixel; anything off the picture is ignored. */
  set(x: number, y: number, rgb: readonly [number, number, number]): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    this.data.set(rgb, (y * this.width + x) * 3)
  }

  get(x: number, y: number): [number, number, number] {
    const i = (y * this.width + x) * 3
    return [this.data[i], this.data[i + 1], this.data[i + 2]]
  }

  /** A filled disc of `radius` pixels around (cx, cy). */
  dot(cx: number, cy: number, radius: number, rgb: readonly [number, number, number]): void {
    const r = Math.max(0.5, radius)
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, rgb)
  }

  /**
   * The picture as a PNG file. The pixels are stored uncompressed (deflate "stored" blocks), which keeps the encoder
   * tiny and dependency-free; for the sizes a camera sensor makes (tens of pixels a side) the file is a few kilobytes.
   */
  toPng(): Uint8Array {
    const { width: w, height: h } = this
    const raw = new Uint8Array(h * (1 + w * 3)) // each row: a filter byte (0 = none), then the pixels
    for (let y = 0; y < h; y++) raw.set(this.data.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1)
    const chunks = [chunk('IHDR', new Uint8Array([...be32(w), ...be32(h), 8, 2, 0, 0, 0])), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))]
    const out = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0))
    out.set([137, 80, 78, 71, 13, 10, 26, 10])
    let at = 8
    for (const c of chunks) { out.set(c, at); at += c.length }
    return out
  }

  /** The PNG as base64 text, the form model APIs take. */
  toBase64(): string {
    const bytes = this.toPng()
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  }
}

const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

let crcTable: Uint32Array | null = null
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  }
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i)
  body.set(data, 4)
  return new Uint8Array([...be32(data.length), ...body, ...be32(crc32(body))])
}

/** A zlib stream made of stored (uncompressed) deflate blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  out[0] = 0x78; out[1] = 0x01
  let at = 2
  for (let b = 0; b < blocks; b++) {
    const part = raw.subarray(b * 65535, (b + 1) * 65535)
    out[at++] = b === blocks - 1 ? 1 : 0
    out[at++] = part.length & 255; out[at++] = part.length >>> 8
    out[at++] = ~part.length & 255; out[at++] = (~part.length >>> 8) & 255
    out.set(part, at); at += part.length
  }
  let a = 1, c = 0
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; c = (c + a) % 65521 }
  out.set(be32(((c << 16) | a) >>> 0), at)
  return out
}
