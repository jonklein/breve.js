import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from '../../../scripts/blog.mjs'

test('posts.generated.json is up to date with the markdown in blog/ (run `npm run blog` to refresh it)', () => {
  const file = readFileSync(new URL('../src/posts.generated.json', import.meta.url), 'utf8')
  assert.equal(file, build())
})

test('every post has what the page needs, newest first, with unique slugs', () => {
  const posts = JSON.parse(build()) as { slug: string; title: string; date: string; summary: string; body: string }[]
  for (const p of posts) {
    assert.match(p.slug, /^[\w-]+$/)
    assert.ok(p.title && p.summary && p.body, `${p.slug} is missing a title, summary or body`)
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/)
  }
  assert.deepEqual(posts.map((p) => p.date), [...posts.map((p) => p.date)].sort().reverse())
  assert.equal(new Set(posts.map((p) => p.slug)).size, posts.length)
})
