// Builds docs/stdlib.md from the doc comments in packages/stdlib/src. Run: node scripts/gen-docs.mjs
// The standard library docs are generated, never hand-edited: change the comment, then regenerate.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)

const INTRO = `# Standard library

Everything here is available to scripts without importing anything. It lives in its own package
(\`packages/stdlib\`), apart from the simulation engine, and this page is generated from its source comments.

Scripts reach it through the values they are given: \`self\` and \`neighbors\` in \`act\`, \`ctx\` for helpers
(\`ctx.vec(x, y, z)\`, \`ctx.mlp([...])\`), and the field arguments of a lattice \`update\`.
For the scene format and the script contract, see the Scene and script reference.
`

function clean(block) {
  return block
    .replace(/^\s*\/\*\*\s?/, '')
    .replace(/\s*\*\/\s*$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim()
}

function parse(file, text) {
  const lines = text.split('\n')
  const out = []
  let doc = ''
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trimStart().startsWith('/**')) {
      let block = line
      while (!block.includes('*/')) block += '\n' + lines[++i]
      doc = clean(block)
      continue
    }
    const top = line.match(/^export (?:abstract )?(class|interface|function|type) (\w+)/)
    if (top) {
      current = { kind: top[1], name: top[2], doc, members: [], file, signature: line.replace(/\s*\{\s*$/, '') }
      out.push(current)
      doc = ''
      if (top[1] !== 'class' && top[1] !== 'interface') current = null
      continue
    }
    if (current && /^}/.test(line)) { current = null; doc = ''; continue }
    const m = current && line.match(/^  (?!private|protected|constructor|\/\/|\})((?:static |readonly |get )*)(\w+)(\??)\s*(\(|:|<)/)
    if (m) {
      const sig = line.trim().replace(/\s*\{.*$/, '').replace(/\s*=>\s*\{?$/, '')
      current.members.push({ name: m[2], doc, sig })
      doc = ''
    } else if (line.trim() && !line.trimStart().startsWith('//')) doc = doc && /^\s*\w+/.test(line) && !current ? '' : doc
  }
  return out
}

export function generate() {
  const dir = new URL('packages/stdlib/src/', root)
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts').sort()
  let md = INTRO
  for (const f of files) {
    const items = parse(f, readFileSync(new URL(f, dir), 'utf8'))
    for (const it of items) {
      md += `\n## ${it.name}\n\n`
      if (it.doc) md += `${it.doc}\n\n`
      for (const m of it.members) {
        md += `### \`${it.name}.${m.name}\`\n\n\`\`\`ts\n${m.sig}\n\`\`\`\n\n${m.doc ? m.doc + '\n\n' : ''}`
      }
    }
  }
  return md.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('docs/stdlib.md', root), generate())
  console.log('wrote docs/stdlib.md')
}
