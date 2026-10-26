import { mountNav } from './site-nav'
import { loadExamples, userProjects, type ExampleInfo } from './projects'

mountNav(document.getElementById('site-nav')!, 'gallery')

interface Card { id: string; title: string; description: string; tags: string[]; thumb?: string; example: boolean }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const { class: cls, ...rest } = props
  const e = Object.assign(document.createElement(tag), rest)
  if (cls) e.className = cls
  e.append(...kids)
  return e
}

function card(c: Card): HTMLElement {
  const thumb = el('div', { class: 'thumb' })
  if (c.thumb) {
    const img = el('img', { src: c.thumb, alt: '', loading: 'lazy' })
    // an example without a picture (or a project of yours) shows a plain tile rather than a broken image
    img.addEventListener('error', () => img.remove())
    thumb.append(img)
  }
  const copy = el('button', { textContent: 'Copy link', title: 'Copy a link to open this in the workbench' })
  copy.addEventListener('click', async () => {
    const link = `${location.origin}/sim/#${c.id}`
    try { await navigator.clipboard.writeText(link) } catch { window.prompt('Copy this link', link) }
    copy.textContent = 'Copied'
    setTimeout(() => { copy.textContent = 'Copy link' }, 1500)
  })
  return el('article', { class: 'card' },
    el('a', { href: `/sim/#${c.id}`, class: 'thumb-link', ariaLabel: `Open ${c.title}` }, thumb),
    el('div', { class: 'card-body' },
      el('h3', {}, el('a', { href: `/sim/#${c.id}`, textContent: c.title })),
      el('p', { textContent: c.description }),
      el('div', { class: 'tags' }, ...c.tags.map((t) => el('span', { class: 'tag', textContent: t }))),
      el('div', { class: 'actions' },
        el('a', { class: 'button primary', href: `/sim/#${c.id}`, textContent: 'Open' }),
        el('a', { class: 'button', href: `/sim/?fork=${encodeURIComponent(c.id)}`, textContent: 'Fork', title: 'Copy it into your own projects and open the copy' }),
        copy)))
}

const toCard = (e: ExampleInfo): Card => ({ id: e.id, title: e.name, description: e.description, tags: e.tags ?? [], thumb: `/${e.id}/thumb.jpg`, example: true })

async function main(): Promise<void> {
  const cards = document.getElementById('cards')!
  const filters = document.getElementById('filters')!
  const examples = (await loadExamples()).map(toCard)
  const tags = [...new Set(examples.flatMap((e) => e.tags))].sort()
  let active: string | null = null
  const render = () => {
    cards.replaceChildren(...examples.filter((e) => !active || e.tags.includes(active)).map(card))
    filters.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.tag ?? null) === active)))
  }
  for (const t of [null, ...tags]) {
    const b = el('button', { class: 'chip', textContent: t ?? 'all' })
    b.dataset.tag = t ?? ''
    if (t === null) delete b.dataset.tag
    b.addEventListener('click', () => { active = t; render() })
    filters.append(b)
  }
  render()

  const mine = userProjects()
  if (mine.length) {
    document.getElementById('mine-title')!.classList.remove('hidden')
    document.getElementById('mine-note')!.classList.remove('hidden')
    const names = new Map(examples.map((e) => [e.id, e.title]))
    document.getElementById('mine')!.replaceChildren(...mine.map((p) => card({ id: p.id, title: p.name, description: p.from ? `A copy of ${names.get(p.from) ?? 'another project'}.` : 'Your project.', tags: [], example: false })))
  }
}

void main()
