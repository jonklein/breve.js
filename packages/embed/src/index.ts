import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Sim, parseScene, type ScriptModule } from '@breve/core'
import { WorldView, type WorldFrame, type WorldLook } from '@breve/view'

export interface EmbedOptions {
  /** Height in pixels when the container has none of its own (default 420). */
  height?: number
  /** Slowly turn the camera around the scene until someone drags it (default true). */
  autoRotate?: boolean
  /** Simulation speed as a multiple of the scene's own tick rate (default 1: 60 ticks a second unless the scene says otherwise). */
  speed?: number
  /** How far to zoom in from the default camera, as a multiple (default 1; 1.3 is a little closer). */
  zoom?: number
  /** Start paused (default false). */
  paused?: boolean
  /** Where relative paths to models (a body part's `visual.gltf`) start: a URL ending in `/`. Default: the page's own address. */
  assetBase?: string
}

export interface Running {
  /** The simulation, for poking at from the page's own script. */
  sim: Sim
  pause(): void
  play(): void
  /** Start over from the seed. */
  reset(): Promise<void>
  /** Stop and remove the canvas. */
  stop(): void
}

async function compile(code: string): Promise<ScriptModule> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    return (await import(/* @vite-ignore */ url)) as ScriptModule
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Run a simulation on a web page with nothing but the picture: no editors, sliders or buttons.
 *
 *   breve.run('#demo', scriptSource, sceneConfig)
 *
 * `scriptSource` is the text of the script (the same file the workbench edits), `config` is the scene
 * (the scene.json contents, as an object or as JSON text), and the scene's default params are used as they are.
 * Drag to orbit, scroll to zoom. The simulation pauses while it is scrolled out of view.
 */
export async function run(target: string | HTMLElement, code: string, config: unknown, options: EmbedOptions = {}): Promise<Running> {
  const host = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target
  if (!host) throw new Error(`breve.run: nothing on the page matches "${String(target)}"`)
  const parsed = parseScene(typeof config === 'string' ? config : JSON.stringify(config))
  if (!parsed.ok) throw new Error(`breve.run: the scene config is not valid:\n${parsed.errors.join('\n')}`)
  const scene = parsed.scene
  const script = await compile(code)
  let sim = await Sim.create(scene, script)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const canvas = renderer.domElement
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'
  if (!host.clientHeight) host.style.height = `${options.height ?? 420}px`
  host.appendChild(canvas)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.autoRotate = options.autoRotate !== false
  controls.autoRotateSpeed = 0.6
  controls.addEventListener('start', () => { controls.autoRotate = false })
  const view = new WorldView(renderer, camera, controls)
  if (options.assetBase) view.setAssetBase(options.assetBase)
  view.setWorld(scene.world as WorldLook | undefined)

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    view.setAspect(w / h)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  let running = !options.paused
  let visible = true
  let stopped = false
  let last = performance.now()
  let budget = 0
  const watch = new IntersectionObserver((e) => { visible = e[0].isIntersecting })
  watch.observe(host)

  const draw = () => view.update(sim.frames().map((f) => ({ ...f, rate: sim.rate }) as WorldFrame))
  draw()
  if (options.zoom && options.zoom !== 1) {
    // the view framed the world on its first draw; move the camera along its line of sight
    camera.position.sub(controls.target).multiplyScalar(1 / options.zoom).add(controls.target)
    controls.update()
  }
  const loop = (now: number) => {
    if (stopped) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (visible) {
      if (running) {
        budget = Math.min(budget + dt * sim.rate * (options.speed ?? 1), 8) // never try to catch up on more than a few ticks at once
        let stepped = false
        while (budget >= 1) { sim.step(); budget--; stepped = true }
        if (stepped) draw()
      }
      view.tick(dt)
      controls.update()
      renderer.render(view.scene, camera)
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  return {
    get sim() { return sim },
    pause: () => { running = false },
    play: () => { running = true },
    async reset() {
      const next = await Sim.create(scene, script)
      sim.dispose()
      sim = next
      draw()
    },
    stop() {
      stopped = true
      observer.disconnect()
      watch.disconnect()
      controls.dispose()
      sim.dispose()
      renderer.dispose()
      canvas.remove()
    },
  }
}
