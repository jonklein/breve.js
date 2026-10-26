// Convert a MuJoCo (MJCF) model into a body for scene.json:  npm run urdf -- path/to/model.xml
import { readFileSync } from 'node:fs'
import { importMjcf } from '../packages/core/src/index.ts'

const file = process.argv[2]
if (!file) { console.error('usage: npm run mjcf -- model.xml'); process.exit(1) }
const r = importMjcf(readFileSync(file, 'utf8'))
for (const w of r.warnings) console.error('warning:', w)
if (r.errors.length) { console.error(r.errors.map((e) => 'error: ' + e).join('\n')); process.exit(1) }
console.log(JSON.stringify(r.body, null, 2))
