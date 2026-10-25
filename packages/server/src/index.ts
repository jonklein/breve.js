import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chat, configured, decide, DECIDE_MODEL, MODEL, type Turn } from './llm'

// the pages shown in the workbench's Docs tab, read fresh so edits show up on reload
const DOCS: Record<string, { title: string; file: string }> = {
  reference: { title: 'Scene and script reference', file: 'script-api.md' },
  stdlib: { title: 'Standard library', file: 'stdlib.md' },
}
const docsDir = new URL('../../../docs/', import.meta.url)

const PORT = Number(process.env.BREVE_API_PORT || 8787)
const MAX_BODY = 2_000_000

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const parts: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('request too large')); req.destroy() } else parts.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const isTurns = (v: unknown): v is Turn[] =>
  Array.isArray(v) && v.every((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')

function friendly(e: unknown): { status: number; error: string } {
  if (e instanceof Anthropic.AuthenticationError) return { status: 401, error: 'The Anthropic API rejected the key in .env. Check ANTHROPIC_API_KEY and restart.' }
  if (e instanceof Anthropic.RateLimitError) return { status: 429, error: 'Rate limited by the Anthropic API. Wait a moment and try again.' }
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, error: 'Could not reach the Anthropic API. Check your network connection.' }
  if (e instanceof Anthropic.APIError) return { status: 502, error: `Anthropic API error ${e.status}: ${e.message}` }
  return { status: 500, error: e instanceof Error ? e.message : String(e) }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/status') return send(res, 200, { llm: configured(), model: MODEL })
    if (req.method === 'GET' && req.url === '/api/docs') return send(res, 200, Object.entries(DOCS).map(([id, d]) => ({ id, title: d.title })))
    const page = req.method === 'GET' ? req.url?.match(/^\/api\/docs\/(\w+)$/)?.[1] : undefined
    if (page && DOCS[page]) {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' })
      return void res.end(readFileSync(fileURLToPath(new URL(DOCS[page].file, docsDir)), 'utf8'))
    }
    if (req.method === 'POST' && req.url === '/api/decide') {
      if (!configured()) return send(res, 503, { error: 'No API key. Put ANTHROPIC_API_KEY=... in .env at the project root and restart `npm run dev`.' })
      const body = JSON.parse(await readBody(req)) as { prompt?: unknown; json?: unknown }
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 20000) return send(res, 400, { error: 'expected { prompt: string, json?: boolean }' })
      return send(res, 200, { text: await decide(body.prompt, body.json === true), model: DECIDE_MODEL })
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      if (!configured()) return send(res, 503, { error: 'No API key. Put ANTHROPIC_API_KEY=... in .env at the project root and restart `npm run dev`.' })
      const body = JSON.parse(await readBody(req)) as { history?: unknown; request?: unknown; project?: { name?: unknown; scene?: unknown; script?: unknown } }
      const { request, project } = body
      const history = body.history ?? []
      if (typeof request !== 'string' || !request.trim() || !isTurns(history) || !project || typeof project.scene !== 'string' || typeof project.script !== 'string')
        return send(res, 400, { error: 'expected { history, request, project: { name, scene, script } }' })
      const result = await chat(history, request, { name: String(project.name ?? 'project'), scene: project.scene, script: project.script })
      return send(res, 200, result)
    }
    send(res, 404, { error: 'not found' })
  } catch (e) {
    const { status, error } = friendly(e)
    if (status === 500) console.error(e)
    send(res, status, { error })
  }
})

// Local only: this process holds the API key.
server.listen(PORT, '127.0.0.1', () => console.log(`breve api on http://127.0.0.1:${PORT} · model ${MODEL} · key ${configured() ? 'set' : 'missing'}`))
