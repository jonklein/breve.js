// Click through the site in a real (headless) browser and check the main flows still work.
//   npm run dev -w @breve/workbench      (in another terminal)
//   node scripts/check-ui.mjs
// It needs Playwright with Chromium installed (not a dependency of this repo) and prints one line per check.
// Set BREVE_URL if the dev server is not at http://localhost:5173.
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright')
const base = process.env.BREVE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
// a language model is not needed to check the thinking controls: answer every question the same way
await page.route('**/api/decide', (r) => r.fulfill({ json: { text: '{"dx":0.5,"dz":-0.5,"turn":0.2,"go":1}' } }))

let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(ok ? 'ok  ' : 'FAIL', name, detail) }
const sim = async (hash) => { await page.goto(`${base}/sim/#${hash}`); await page.waitForTimeout(2500) }
const tickOf = async () => Number((await page.textContent('#timeline-label')).match(/tick (\d+)/)[1])

// home: three demos start when scrolled to, and an old workbench link still works
await page.goto(`${base}/`)
await page.evaluate(() => document.getElementById('demos').scrollIntoView())
await page.waitForTimeout(6000)
check('home runs three live demos', (await page.locator('.demo canvas').count()) === 3)
await page.goto(`${base}/?embed#boids`)
await page.waitForTimeout(800)
check('old /?embed#id links redirect to /sim/', page.url().includes('/sim/?embed'), page.url())

// gallery: every example, tag filter, fork, share round trip
await page.goto(`${base}/gallery/`)
await page.waitForSelector('.card')
const total = await page.locator('#cards .card').count()
await page.click('.chip:has-text("physics")')
check('gallery lists examples and filters by tag', total >= 13 && (await page.locator('#cards .card').count()) < total, `${total} cards`)
await page.goto(`${base}/sim/?fork=boids`)
await page.waitForTimeout(2000)
check('gallery Fork opens a copy', (await page.inputValue('#name')) === 'Boids copy')

// tree editor: one edit changes one line of text; a bad value shows an inline error
await sim('ants')
const text = () => page.evaluate(() => window.breve.sceneEditor.getText())
const before = await text()
await page.click('#view-toggle')
await page.waitForSelector('#tree-scene .tree-row')
const count = page.locator('#tree-scene .tree-node', { has: page.locator('> .tree-row > .tree-key', { hasText: /^count$/ }) }).first().locator('input[type=number]').first()
await count.fill('120'); await count.dispatchEvent('change')
await page.waitForTimeout(500)
const after = await text()
check('tree edit changes exactly one line', before.split('\n').filter((l, i) => l !== after.split('\n')[i]).length === 1)
const size = page.locator('#tree-scene .tree-node', { has: page.locator('> .tree-row > .tree-key', { hasText: /^bounds$/ }) }).first().locator('input[type=number]').first()
await size.fill('-5'); await size.dispatchEvent('change')
await page.waitForTimeout(1200)
check('tree shows validation errors inline', (await page.locator('#tree-scene .tree-err').count()) > 0)
await page.click('#view-toggle')

// timeline: scrub back, stay paused, resume as a branch (a flocking scene and a physics scene)
for (const id of ['boids', 'creature']) {
  await sim(id)
  await page.waitForTimeout(id === 'creature' ? 3500 : 1500)
  const [min, max] = await page.evaluate(() => { const s = document.getElementById('timeline-slider'); return [Number(s.min), Number(s.max)] })
  const to = Math.round((min + max) / 2 / 10) * 10
  await page.evaluate((t) => { const s = document.getElementById('timeline-slider'); s.value = String(t); s.dispatchEvent(new Event('input', { bubbles: true })) }, to)
  await page.waitForTimeout(700)
  const t1 = await tickOf(); await page.waitForTimeout(400)
  check(`timeline scrubs back and pauses (${id})`, t1 === to && (await tickOf()) === t1, `tick ${t1}`)
  await page.click('#play'); await page.waitForTimeout(1200)
  check(`timeline resumes as a branch (${id})`, (await tickOf()) > to)
}

// thinking controls: lockstep, save a log, replay it with no new questions
let asked = 0
await page.route('**/api/decide', async (r) => { asked++; await r.fulfill({ json: { text: '{"dx":0.5,"dz":-0.5}' } }) })
await sim('llm-wanderers')
check('thinking bar shows for a scene that thinks', await page.isVisible('#thinkbar'))
check('a model-driven set is flagged not repeatable', await page.isVisible('#flags'))
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#think-save')])
const logPath = await download.path()
const fs = await import('node:fs')
const log = JSON.parse(fs.readFileSync(logPath, 'utf8'))
fs.writeFileSync(logPath + '.json', JSON.stringify(log))
const before2 = asked
await page.setInputFiles('#think-file', logPath + '.json')
await page.waitForTimeout(2500)
check('a saved decision log replays without asking the model', log.length > 0 && asked === before2 && /replaying/.test(await page.textContent('#think-count')), `${log.length} decisions`)

// a project opened from a share link is held until approved
await sim('boids')
const scene = await text()
const evil = "fetch('/api/chat', { method: 'POST', body: '{}' }).catch(() => {})\nexport default { decide: () => ({}) }\n"
let chatCalls = 0
await page.route('**/api/chat', async (r) => { chatCalls++; await r.fulfill({ json: {} }) })
const link = await page.evaluate(async ([s, c]) => { const m = await import('/src/share.ts'); return location.origin + '/sim/#s=' + await m.encodeShare({ name: 'Held', scene: s, script: c }) }, [scene, evil])
await page.goto('about:blank'); await page.goto(link)
await page.waitForTimeout(2500)
check('shared project is held and its script has not run', (await page.isVisible('#held')) && chatCalls === 0)
await page.click('#held-run')
await page.waitForTimeout(2000)
check('Run approves it, and it then runs', !(await page.isVisible('#held')) && chatCalls === 1)

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
await browser.close()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
