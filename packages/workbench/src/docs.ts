import { marked } from 'marked'
import { site } from './site-root'

interface Page { id: string; title: string }

/** The Docs tab: the reference pages, fetched from the local server and rendered as HTML, with a contents list and in-page search. */
export class DocsPanel {
  private pages: Page[] = []
  private current = ''
  private cache = new Map<string, string>()
  private body = document.createElement('div')
  private nav = document.createElement('div')
  private search = document.createElement('input')
  private loaded = false

  constructor(private root: HTMLElement) {
    this.nav.className = 'docs-nav'
    this.search.type = 'search'
    this.search.placeholder = 'Find in this page'
    this.search.setAttribute('aria-label', 'Find in this page')
    this.search.addEventListener('input', () => this.filter())
    this.body.className = 'docs-body'
    this.root.append(this.nav, this.body)
  }

  /** Load the page list the first time the tab is shown. */
  async show(open?: string): Promise<void> {
    if (!this.loaded) {
      this.loaded = true
      try {
        this.pages = (await (await fetch(site('api/docs'))).json()) as Page[]
      } catch {
        this.body.textContent = 'The docs come from the local server. Start it with `npm run dev`.'
        this.loaded = false
        return
      }
      this.renderNav()
    }
    await this.open(open ?? this.current ?? this.pages[0]?.id)
  }

  private renderNav(): void {
    this.nav.replaceChildren()
    for (const p of this.pages) {
      const b = document.createElement('button')
      b.textContent = p.title
      b.dataset.id = p.id
      b.addEventListener('click', () => void this.open(p.id))
      this.nav.appendChild(b)
    }
    this.nav.appendChild(this.search)
  }

  async open(id: string, anchor?: string): Promise<void> {
    if (!id) id = this.pages[0]?.id
    if (!id) return
    this.current = id
    this.nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === id))
    let md = this.cache.get(id)
    if (md === undefined) {
      const r = await fetch(site(`api/docs/${id}`))
      md = r.ok ? await r.text() : `Could not load this page (${r.status}).`
      this.cache.set(id, md)
    }
    this.body.innerHTML = await marked.parse(md)
    // anchors for headings, so sections can be linked and jumped to
    const seen = new Set<string>()
    this.body.querySelectorAll('h1, h2, h3').forEach((h) => {
      let slug = (h.textContent ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      while (seen.has(slug)) slug += '-'
      seen.add(slug)
      h.id = slug
    })
    this.search.value = ''
    if (anchor) this.body.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView()
    else this.body.scrollTop = 0
  }

  /** Hide sections that do not mention the search text: a section runs from one heading to the next. */
  private filter(): void {
    const q = this.search.value.trim().toLowerCase()
    let show = true
    for (const el of Array.from(this.body.children) as HTMLElement[]) {
      if (/^H[1-3]$/.test(el.tagName)) {
        let text = el.textContent ?? ''
        let n = el.nextElementSibling
        while (n && !/^H[1-3]$/.test(n.tagName)) { text += ' ' + (n.textContent ?? ''); n = n.nextElementSibling }
        show = !q || text.toLowerCase().includes(q)
      }
      el.hidden = !show
    }
  }
}
