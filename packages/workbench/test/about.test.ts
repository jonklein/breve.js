import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { renderMarkdown } from '../src/about'

test('descriptions render paragraphs, lists, emphasis and links that open in a new tab', () => {
  const html = renderMarkdown('Intro with **bold**, *soft* and `code`.\n\n### Try\n- one\n- see [wiki](https://en.wikipedia.org/wiki/Boids)')
  assert.match(html, /<p>Intro with <strong>bold<\/strong>, <em>soft<\/em> and <code>code<\/code>\.<\/p>/)
  assert.match(html, /<h4>Try<\/h4>/)
  assert.match(html, /<ul><li>one<\/li><li>see <a href="https:\/\/en\.wikipedia\.org\/wiki\/Boids" target="_blank" rel="noopener noreferrer">wiki<\/a><\/li><\/ul>/)
})

test('a description cannot inject HTML or script links', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> [bad](javascript:alert(1)) <script>x</script>')
  assert.ok(!html.includes('<img') && !html.includes('<script'))
  assert.ok(!html.includes('href="javascript'))
})

test('every example has a short description file', () => {
  const root = new URL('../../../examples/', import.meta.url)
  const index = JSON.parse(readFileSync(new URL('index.json', root), 'utf8')) as { id: string; about?: string }[]
  for (const e of index) {
    assert.ok(e.about, `${e.id} lists an about file`)
    const file = new URL(`${e.id}/${e.about}`, root)
    assert.ok(existsSync(file), `${e.id}/${e.about} exists`)
    const words = readFileSync(file, 'utf8').split(/\s+/).length
    assert.ok(words > 20 && words < 220, `${e.id} description is short but not empty (${words} words)`)
  }
})
