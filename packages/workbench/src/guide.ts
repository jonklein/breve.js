import { marked } from 'marked'
import { mountNav } from './site-nav'
import chapters from './guide.generated.json'

// The guide is one page: `/guide/#/<chapter>`, with the chapters listed beside it. Chapters are the markdown files in guide/, turned into
// guide.generated.json by `npm run guide`. They are written by the people who run the site, so their markdown is rendered as it is.
mountNav(document.getElementById('site-nav')!, 'guide')

interface Chapter { slug: string; title: string; summary: string; body: string }
const all = chapters as Chapter[]
const root = document.getElementById('guide')!
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props)

function show(slug: string): void {
  const i = Math.max(0, all.findIndex((c) => c.slug === slug))
  const c = all[i]
  document.title = `${c.title} · Getting started · breve`
  const list = el('nav', { className: 'guide-toc', ariaLabel: 'Chapters' })
  list.append(el('h2', { textContent: 'Getting started' }))
  all.forEach((x, k) => {
    const a = el('a', { href: `#/${x.slug}`, textContent: `${k + 1}. ${x.title}` })
    if (k === i) a.setAttribute('aria-current', 'page')
    list.append(a)
  })
  const article = el('article', { className: 'prose guide-body' })
  article.innerHTML = `<h1></h1>${marked.parse(c.body, { async: false }) as string}`
  article.querySelector('h1')!.textContent = c.title
  const pager = el('div', { className: 'guide-pager' })
  if (all[i - 1]) pager.append(el('a', { href: `#/${all[i - 1].slug}`, textContent: `← ${all[i - 1].title}` }))
  if (all[i + 1]) pager.append(el('a', { href: `#/${all[i + 1].slug}`, textContent: `${all[i + 1].title} →`, className: 'next' }))
  article.append(pager)
  root.replaceChildren(el('div', { className: 'guide-layout' }))
  root.firstElementChild!.append(list, article)
  window.scrollTo(0, 0)
}

const route = () => show(/^#\/([\w-]+)$/.exec(location.hash)?.[1] ?? all[0].slug)
window.addEventListener('hashchange', route)
route()
