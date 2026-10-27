// Make the gallery pictures: examples/<id>/thumb.jpg, one per example, from the running workbench.
//   npm run dev -w @breve/workbench      (in another terminal)
//   node scripts/thumbs.mjs [id ...]     (needs Playwright with Chromium installed; it is not a dependency of this repo)
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const base = process.env.BREVE_URL ?? 'http://localhost:5173'
const examples = JSON.parse(readFileSync(new URL('../examples/index.json', import.meta.url), 'utf8'))
const only = process.argv.slice(2)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'] }) // WebGPU (software) for the examples that keep their cells on a graphics card
const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
// the thinking example asks a model; a fixed answer is enough for a picture
await page.route('**/api/decide', (r) => r.fulfill({ json: { text: JSON.stringify({ dx: 0.4, dz: -0.3 }) } }))
for (const e of examples) {
  if (only.length && !only.includes(e.id)) continue
  await page.goto(`${base}/sim/?embed&quality=${process.env.BREVE_QUALITY ?? 'medium'}#${e.id}`) // software GL is slow: no ambient occlusion unless asked
  // let it run long enough to look like itself; bodies need the physics engine to load first
  // (a software graphics card is slow: the formula lattices need a good while to compile, run and draw the first generations)
  const wait = { 'life2d-formula': 20000, 'life-giant': 45000 }[e.id] ?? (['creature', 'creature-gltf', 'urdf-bot', 'morphology', 'evolved-creatures'].includes(e.id) ? 7000 : 4500)
  await page.waitForTimeout(wait)
  // creatures are small in a big arena: zoom in on the middle of the view
  if (['creature', 'creature-gltf', 'urdf-bot', 'morphology'].includes(e.id)) { await page.mouse.move(400, 250); await page.mouse.wheel(0, -900); await page.waitForTimeout(800) }
  await page.screenshot({ path: new URL(`../examples/${e.id}/thumb.jpg`, import.meta.url).pathname, type: 'jpeg', quality: 78 })
  console.log('thumb', e.id)
}
await browser.close()
