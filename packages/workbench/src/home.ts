import { mountNav } from './site-nav'

// Old links to the workbench pointed at the site root (`/?embed#boids`); keep them working.
if (new URLSearchParams(location.search).has('embed') || location.hash.length > 1) location.replace('/sim/' + location.search + location.hash)

mountNav(document.getElementById('site-nav')!, 'home')

interface Demo { id: string; title: string; blurb: string; scene: string; script: string; zoom?: number }

const DEMOS: Demo[] = [
  { id: 'boids', title: 'Boids', blurb: 'Three rules (stay close, line up, keep apart) and a flock appears.', scene: '/boids/scene.json', script: '/boids/flock.js' },
  { id: 'ants', title: 'Ants', blurb: 'Foragers leave a trail that fades. The colony finds the food without a plan.', scene: '/ants/scene.json', script: '/ants/ants.js' },
  { id: 'epidemic', title: 'Epidemic', blurb: 'A disease on a small-world network. Change the contact rate and watch it burn out or take hold.', scene: '/epidemic/scene.json', script: '/epidemic/contagion.js' },
]

const host = document.getElementById('demos')!
for (const d of DEMOS) {
  const card = document.createElement('article')
  card.className = 'demo'
  card.innerHTML = `<div class="stage"><span>loading…</span></div><div class="info"><h3></h3><p></p><a>Open in the workbench →</a></div>`
  card.querySelector('h3')!.textContent = d.title
  card.querySelector('p')!.textContent = d.blurb
  card.querySelector('a')!.setAttribute('href', `/sim/#${d.id}`)
  host.append(card)
  const stage = card.querySelector<HTMLElement>('.stage')!
  // nothing is fetched or started until the card is close to the screen; the embed then pauses itself when it leaves
  const watch = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    watch.disconnect()
    void start(d, stage)
  }, { rootMargin: '200px' })
  watch.observe(card)
}

async function start(d: Demo, stage: HTMLElement): Promise<void> {
  try {
    const [{ run }, scene, script] = await Promise.all([
      import('@breve/embed'),
      fetch(d.scene).then((r) => r.json()),
      fetch(d.script).then((r) => r.text()),
    ])
    stage.replaceChildren()
    await run(stage, script, scene, { height: stage.clientHeight || 260 })
  } catch (e) {
    stage.textContent = `could not start this demo: ${e instanceof Error ? e.message : String(e)}`
  }
}
