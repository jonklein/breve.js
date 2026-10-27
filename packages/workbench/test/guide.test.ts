import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { build } from '../../../scripts/guide.mjs'

test('guide.generated.json is up to date with the markdown in guide/ (run `npm run guide` to refresh it)', () => {
  assert.equal(readFileSync(new URL('../src/guide.generated.json', import.meta.url), 'utf8'), build())
})

test('every chapter has a title and summary, the chapters are in order, and each link to another chapter or example lands somewhere', () => {
  const chapters = JSON.parse(build()) as { slug: string; title: string; summary: string; body: string }[]
  assert.ok(chapters.length >= 5)
  const slugs = chapters.map((c) => c.slug)
  assert.deepEqual(slugs, [...slugs].sort())
  const examples = new Set((JSON.parse(readFileSync(new URL('../../../examples/index.json', import.meta.url), 'utf8')) as { id: string }[]).map((e) => e.id))
  for (const c of chapters) {
    assert.ok(c.title && c.summary && c.body.length > 200, c.slug)
    for (const m of c.body.matchAll(/\]\(#\/([\w-]+)\)/g)) assert.ok(slugs.includes(m[1]), `${c.slug} links to a chapter that does not exist: ${m[1]}`)
    for (const m of c.body.matchAll(/\]\(\.\.\/sim\/#([\w-]+)\)/g)) assert.ok(examples.has(m[1]), `${c.slug} links to an example that does not exist: ${m[1]}`)
  }
})

test('the page and its script exist and the nav links to it', () => {
  for (const f of ['../guide/index.html', '../src/guide.ts']) assert.ok(existsSync(new URL(f, import.meta.url)), f)
  assert.match(readFileSync(new URL('../src/site-nav.ts', import.meta.url), 'utf8'), /'guide'/)
})
