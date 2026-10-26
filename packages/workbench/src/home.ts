import { mountNav } from './site-nav'

// Old links to the workbench pointed at the site root (`/?embed#boids`); keep them working.
if (new URLSearchParams(location.search).has('embed') || location.hash.length > 1) location.replace('/sim/' + location.search + location.hash)

mountNav(document.getElementById('site-nav')!, 'home')

// A real simulation fills the window behind the words. It is started after the page has painted, and stays paused for people who
// asked their system for less motion.
const BACKDROP = { scene: '/boids/scene.json', script: '/boids/flock.js' }
const host = document.getElementById('backdrop')!
const toggle = document.getElementById('backdrop-toggle') as HTMLButtonElement
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

async function start(): Promise<void> {
  try {
    const [{ run }, scene, script] = await Promise.all([
      import('@breve/embed'),
      fetch(BACKDROP.scene).then((r) => r.json()),
      fetch(BACKDROP.script).then((r) => r.text()),
    ])
    const running = await run(host, script, scene, { height: window.innerHeight, zoom: 1.35, paused: reduced })
    let paused = reduced
    const show = () => { toggle.textContent = paused ? 'Play' : 'Pause'; toggle.setAttribute('aria-pressed', String(paused)) }
    show()
    toggle.addEventListener('click', () => { paused = !paused; if (paused) running.pause(); else running.play(); show() })
  } catch {
    host.remove() // the page reads fine without the picture
    toggle.remove()
  }
}
requestAnimationFrame(() => setTimeout(() => void start(), 50))
