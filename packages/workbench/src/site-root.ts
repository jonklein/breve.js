/**
 * Where the site lives. Every page, script and worker is built into (or served from) a folder one level below the site's root
 * (`assets/` in a build, `src/` in the dev server), so the root is one step up from here. That lets the site sit at a domain's root
 * or in a subfolder such as a GitHub Pages project site, with no setting for it.
 */
const root = new URL('../', import.meta.url).href

/** A URL inside the site: `site('sim/#boids')`, `site('/index.json')` (a leading slash means the site's root, not the domain's). */
export const site = (path: string): string => new URL(path.replace(/^\//, ''), root).href
