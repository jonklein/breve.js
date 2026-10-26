export type Page = 'home' | 'explore' | 'sim' | 'gallery' | 'blog' | 'docs' | 'about'

export const SOURCE_URL = 'https://github.com/jonklein/breve.js'

const LINKS: { page: Page; href: string; label: string }[] = [
  { page: 'home', href: '/', label: 'Home' },
  { page: 'explore', href: '/explore/', label: 'Explore' },
  { page: 'sim', href: '/sim/', label: 'Simulations' },
  { page: 'gallery', href: '/gallery/', label: 'Gallery' },
  { page: 'blog', href: '/blog/', label: 'Blog' },
  { page: 'docs', href: '/sim/?tab=docs', label: 'Docs' },
  { page: 'about', href: '/about/', label: 'About' },
]

/** The site's navigation, the same on every page: the workbench header, the gallery and the home page all call this. */
export function mountNav(target: HTMLElement, active: Page): void {
  target.replaceChildren()
  const brand = Object.assign(document.createElement('a'), { href: '/', className: 'brand', textContent: 'breve' })
  target.append(brand)
  for (const l of LINKS) {
    const a = Object.assign(document.createElement('a'), { href: l.href, textContent: l.label })
    if (l.page === active) a.setAttribute('aria-current', 'page')
    target.append(a)
  }
  target.append(Object.assign(document.createElement('a'), { href: SOURCE_URL, textContent: 'Source', target: '_blank', rel: 'noopener', className: 'external' }))
}
