const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Bold, italic, code and links inside one line of already-escaped text. Only http(s) links are made, and they open in a new tab. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
}

/**
 * The little bit of Markdown a description needs: `#` headings, paragraphs, `-` lists, and bold, italic, code and links.
 * Anything else, HTML included, is shown as plain text, so a description from a shared project cannot run code.
 */
export function renderMarkdown(md: string): string {
  const out: string[] = []
  let para: string[] = []
  let list: string[] = []
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`)
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`)
    para = []
    list = []
  }
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    const li = /^[-*]\s+(.*)$/.exec(line)
    if (!line) flush()
    else if (h) { flush(); out.push(`<h4>${inline(h[2])}</h4>`) }
    else if (li) { if (para.length) flush(); list.push(li[1]) }
    else { if (list.length) flush(); para.push(line) }
  }
  flush()
  return out.join('')
}

/** A card over the corner of the simulation that explains it. It folds down to a button, and remembers which each simulation was left as. */
export class AboutOverlay {
  private box = document.createElement('aside')
  private toggle = document.createElement('button')
  private body = document.createElement('div')
  private id = ''

  constructor(host: HTMLElement) {
    this.box.className = 'about hidden'
    this.toggle.type = 'button'
    this.toggle.className = 'about-toggle'
    this.body.className = 'about-body'
    this.box.append(this.toggle, this.body)
    host.appendChild(this.box)
    this.toggle.addEventListener('click', () => this.setOpen(this.box.classList.contains('collapsed')))
  }

  private key = () => `breve.about.${this.id}`
  private setOpen(open: boolean): void {
    this.box.classList.toggle('collapsed', !open)
    this.toggle.setAttribute('aria-expanded', String(open))
    try { localStorage.setItem(this.key(), open ? 'open' : 'closed') } catch { /* private window: it just resets next visit */ }
  }

  /** Show the description for a simulation (or nothing, when it has none). */
  show(id: string, title: string, markdown: string | null): void {
    this.id = id
    if (!markdown) { this.box.classList.add('hidden'); return }
    this.toggle.textContent = `About: ${title}`
    this.body.innerHTML = renderMarkdown(markdown)
    this.box.classList.remove('hidden')
    let saved: string | null = null
    try { saved = localStorage.getItem(this.key()) } catch { /* no storage */ }
    this.box.classList.toggle('collapsed', saved === 'closed')
    this.toggle.setAttribute('aria-expanded', String(saved !== 'closed'))
  }
}
