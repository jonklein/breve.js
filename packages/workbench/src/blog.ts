import { marked } from 'marked'
import { mountNav } from './site-nav'
import posts from './posts.generated.json'

// The blog is one page. `/blog/` lists the posts; `/blog/#/<slug>` shows one. Posts are the markdown files in blog/, turned into
// posts.generated.json by `npm run blog`. They are written by the people who run the site, so their markdown is rendered as it is.
mountNav(document.getElementById('site-nav')!, 'blog')

interface Post { slug: string; title: string; date: string; summary: string; draft: boolean; body: string }
const all = posts as Post[]
const showDrafts = new URLSearchParams(location.search).has('drafts')
const visible = all.filter((p) => showDrafts || !p.draft)
const root = document.getElementById('blog')!
const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props)

function list(): void {
  document.title = 'Blog · breve'
  root.replaceChildren(el('h1', { textContent: 'Blog', className: 'blog-title' }))
  if (!visible.length) root.append(el('p', { textContent: 'Nothing here yet.', className: 'lede' }))
  for (const p of visible) {
    const card = el('article', { className: 'post-card' })
    const link = el('a', { href: `/blog/${showDrafts ? '?drafts' : ''}#/${p.slug}`, textContent: p.title })
    const h = el('h2'); h.append(link)
    card.append(h, el('p', { className: 'post-meta muted', textContent: day(p.date) + (p.draft ? ' · draft' : '') }), el('p', { textContent: p.summary }))
    root.append(card)
  }
}

function show(slug: string): void {
  const p = visible.find((x) => x.slug === slug)
  if (!p) return list()
  document.title = `${p.title} · breve`
  const article = el('article', { className: 'prose post' })
  article.innerHTML = `<h1></h1><p class="post-meta muted"></p>${marked.parse(p.body, { async: false }) as string}`
  article.querySelector('h1')!.textContent = p.title
  article.querySelector('.post-meta')!.textContent = day(p.date) + (p.draft ? ' · draft' : '')
  const back = el('a', { href: `/blog/${showDrafts ? '?drafts' : ''}`, textContent: '← All posts', className: 'post-back' })
  root.replaceChildren(back, article)
  window.scrollTo(0, 0)
}

const route = () => { const m = /^#\/([\w-]+)$/.exec(location.hash); if (m) show(m[1]); else list() }
window.addEventListener('hashchange', route)
route()
