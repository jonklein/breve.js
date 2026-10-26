// Turn the markdown posts in blog/ into packages/workbench/src/posts.generated.json, which the blog page renders.
//   node scripts/blog.mjs            write the file
//   node scripts/blog.mjs --check    exit 1 if the file is out of date (used by a test)
// A post is `blog/<anything>.md` that starts with a header between two `---` lines: title, date (YYYY-MM-DD), summary, and
// optionally `draft: true` (drafts are in the file but the page hides them unless the address has ?drafts). The slug is the file name
// without the date prefix and extension.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

const dir = new URL('../blog/', import.meta.url)
const out = new URL('../packages/workbench/src/posts.generated.json', import.meta.url)

export function build() {
  const posts = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const text = readFileSync(new URL(file, dir), 'utf8')
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
    if (!m) throw new Error(`${file}: a post starts with a header between two --- lines (title, date, summary)`)
    const head = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
    for (const k of ['title', 'date', 'summary']) if (!head[k]) throw new Error(`${file}: the header needs "${k}"`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(head.date)) throw new Error(`${file}: date must look like 2026-10-26`)
    posts.push({ slug: file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''), title: head.title, date: head.date, summary: head.summary, draft: head.draft === 'true', body: m[2].trim() })
  }
  const slugs = posts.map((p) => p.slug)
  if (new Set(slugs).size !== slugs.length) throw new Error('two posts have the same slug')
  posts.sort((a, b) => b.date.localeCompare(a.date))
  return JSON.stringify(posts, null, 2) + '\n'
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const text = build()
  if (process.argv.includes('--check')) {
    const same = existsSync(out) && readFileSync(out, 'utf8') === text
    if (!same) { console.error('packages/workbench/src/posts.generated.json is out of date: run `npm run blog`'); process.exit(1) }
  } else {
    writeFileSync(out, text)
    console.log(`wrote ${JSON.parse(text).length} post(s)`)
  }
}
