import type { Doc } from './projects'

export type Shared = Doc & { name?: string }

const toBase64Url = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string): Uint8Array => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

/** A project (scene, script, optional experiment) as text that fits in a URL: JSON, deflated, base64url. */
export async function encodeShare(doc: Shared): Promise<string> {
  return toBase64Url(await pipe(new TextEncoder().encode(JSON.stringify(doc)), new CompressionStream('deflate-raw')))
}

/** The project in a link made by `encodeShare`, or null if the text is not one (so a bad link never breaks the page). */
export async function decodeShare(text: string): Promise<Shared | null> {
  try {
    const doc = JSON.parse(new TextDecoder().decode(await pipe(fromBase64Url(text), new DecompressionStream('deflate-raw')))) as Shared
    return typeof doc.scene === 'string' && typeof doc.script === 'string' ? doc : null
  } catch {
    return null
  }
}
