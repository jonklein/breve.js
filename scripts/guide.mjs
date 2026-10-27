// Turn the markdown chapters in guide/ into packages/workbench/src/guide.generated.json, which the guide page renders.
//   node scripts/guide.mjs            write the file
//   node scripts/guide.mjs --check    exit 1 if the file is out of date (used by a test)
// A chapter is `guide/NN-slug.md` starting with a header between two `---` lines: title and summary. Chapters appear in file-name order.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

const dir = new URL('../guide/', import.meta.url)
const out = new URL('../packages/workbench/src/guide.generated.json', import.meta.url)

export function build() {
  const chapters = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(readFileSync(new URL(file, dir), 'utf8'))
    if (!m) throw new Error(`${file}: a chapter starts with a header between two --- lines (title, summary)`)
    const head = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
    for (const k of ['title', 'summary']) if (!head[k]) throw new Error(`${file}: the header needs "${k}"`)
    if (!/^\d{2}-[a-z0-9-]+\.md$/.test(file)) throw new Error(`${file}: a chapter file is named like 01-first-steps.md`)
    chapters.push({ slug: file.replace(/\.md$/, ''), title: head.title, summary: head.summary, body: m[2].trim() })
  }
  return JSON.stringify(chapters, null, 2) + '\n'
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const text = build()
  if (process.argv.includes('--check')) {
    if (!(existsSync(out) && readFileSync(out, 'utf8') === text)) { console.error('packages/workbench/src/guide.generated.json is out of date: run `npm run guide`'); process.exit(1) }
  } else {
    writeFileSync(out, text)
    console.log(`wrote ${JSON.parse(text).length} chapter(s)`)
  }
}
