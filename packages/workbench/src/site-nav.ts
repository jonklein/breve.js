import { site } from './site-root'
export type Page = 'home' | 'explore' | 'sim' | 'gallery' | 'blog' | 'docs' | 'about'

export const SOURCE_URL = 'https://github.com/jonklein/breve.js'

const LINKS: { page: Page; href: string; label: string }[] = [
  { page: 'home', href: site(''), label: 'Home' },
  { page: 'explore', href: site('explore/'), label: 'Explore' },
  { page: 'sim', href: site('sim/'), label: 'Simulations' },
  { page: 'gallery', href: site('gallery/'), label: 'Gallery' },
  { page: 'blog', href: site('blog/'), label: 'Blog' },
  { page: 'docs', href: site('sim/?tab=docs'), label: 'Docs' },
  { page: 'about', href: site('about/'), label: 'About' },
]

/** The site's navigation, the same on every page: the workbench header, the gallery and the home page all call this. */
export function mountNav(target: HTMLElement, active: Page): void {
  target.replaceChildren()
  const brand = Object.assign(document.createElement('a'), { href: site(''), className: 'brand', textContent: 'breve' })
  target.append(brand)
  for (const l of LINKS) {
    const a = Object.assign(document.createElement('a'), { href: l.href, textContent: l.label })
    if (l.page === active) a.setAttribute('aria-current', 'page')
    target.append(a)
  }
  target.append(Object.assign(document.createElement('a'), { href: SOURCE_URL, textContent: 'Source', target: '_blank', rel: 'noopener', className: 'external' }))
}
