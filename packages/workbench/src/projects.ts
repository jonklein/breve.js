export interface ExampleInfo {
  id: string
  name: string
  description: string
  tags?: string[]
  scene: string
  script: string
  experiment?: string
}

export interface Doc {
  scene: string
  script: string
  /** For a saved copy of an example: a fingerprint of the example's own files when the copy was made, so a later change to the example is noticed. */
  base?: string
  /** An optional experiment.json: what to search over and how. */
  experiment?: string
}

export interface UserProject {
  id: string
  name: string
  /** Id of the example or project it was forked from. */
  from?: string
  /** Came from a shared link and its script has not been approved to run yet. */
  untrusted?: boolean
}

const INDEX_KEY = 'breve:projects'
const docKey = (id: string) => `breve:doc:${id}`
const paramsKey = (id: string) => `breve:params:${id}`

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage unavailable: edits just won't persist */ }
}

export async function loadExamples(): Promise<ExampleInfo[]> {
  return (await fetch('/index.json')).json()
}

export async function fetchExample(e: ExampleInfo): Promise<Doc> {
  const [scene, script, experiment] = await Promise.all([
    fetch(`/${e.id}/${e.scene}`).then((r) => r.text()),
    fetch(`/${e.id}/${e.script}`).then((r) => r.text()),
    e.experiment ? fetch(`/${e.id}/${e.experiment}`).then((r) => r.text()) : Promise.resolve(undefined),
  ])
  return { scene, script, experiment }
}

/** A short fingerprint of a doc's text (FNV-1a), to tell whether an example has changed since a saved copy was made. */
export function fingerprint(d: Doc): string {
  let h = 0x811c9dc5
  for (const part of [d.scene, '\u0000', d.script, '\u0000', d.experiment ?? '']) {
    for (let i = 0; i < part.length; i++) { h ^= part.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  }
  return (h >>> 0).toString(16)
}

export const sameDoc = (a: Doc, b: Doc): boolean => a.scene === b.scene && a.script === b.script && (a.experiment ?? '') === (b.experiment ?? '')

export const userProjects = (): UserProject[] => read<UserProject[]>(INDEX_KEY) ?? []
export const savedDoc = (id: string): Doc | null => read<Doc>(docKey(id))
export const saveDoc = (id: string, doc: Doc): void => write(docKey(id), doc)
export const clearDoc = (id: string): void => { write(docKey(id), null); write(paramsKey(id), null) }

/**
 * Slider values for an example nobody has edited. They are kept apart from a saved copy of the example, so a slider move does not
 * freeze the whole scene and script at today's version: the example can still improve underneath.
 */
export const savedParams = (id: string): Record<string, number> => read<Record<string, number>>(paramsKey(id)) ?? {}
export const saveParams = (id: string, values: Record<string, number>): void => write(paramsKey(id), values)

export function createProject(name: string, from: string | undefined, doc: Doc, untrusted = false): UserProject {
  const p: UserProject = { id: 'p-' + Date.now().toString(36), name, from, ...(untrusted ? { untrusted: true } : {}) }
  write(INDEX_KEY, [...userProjects(), p])
  saveDoc(p.id, doc)
  return p
}

/** The person has read the script and says to run it. */
export function approveProject(id: string): void {
  write(INDEX_KEY, userProjects().map((p) => { if (p.id !== id) return p; const { untrusted: _u, ...rest } = p; return rest }))
}

export function renameProject(id: string, name: string): void {
  write(INDEX_KEY, userProjects().map((p) => (p.id === id ? { ...p, name } : p)))
}

export function deleteProject(id: string): void {
  write(INDEX_KEY, userProjects().filter((p) => p.id !== id))
  clearDoc(id)
}
