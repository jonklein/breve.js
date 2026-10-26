export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
}

/** A small XML reader, enough for URDF and MJCF: elements, attributes, nesting. Comments, declarations and text are skipped. */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (!m[2]) continue
    if (m[1]) {
      if (stack.length > 1 && stack[stack.length - 1].tag === m[2]) stack.pop()
      else throw new Error(`mismatched </${m[2]}>`)
      continue
    }
    const attrs: Record<string, string> = {}
    for (const a of m[3].matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3]
    const node: XmlNode = { tag: m[2], attrs, children: [] }
    stack[stack.length - 1].children.push(node)
    if (!m[4]) stack.push(node)
  }
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1].tag}> is never closed`)
  return root
}

export const kids = (n: XmlNode, tag: string) => n.children.filter((c) => c.tag === tag)
export const kid = (n: XmlNode, tag: string) => kids(n, tag)[0]
export const nums = (s: string | undefined, fallback: number[]): number[] => (s ? s.trim().split(/\s+/).map(Number) : fallback)

/** How far a shape reaches above (and below) its center in the y-up world, given its orientation (a row-major matrix). Used to stand an imported robot on the ground. */
export function halfExtentY(shape: 'box' | 'sphere' | 'capsule' | 'cylinder', size: number[], rot: readonly number[]): number {
  switch (shape) {
    case 'box': return (Math.abs(rot[3]) * size[0] + Math.abs(rot[4]) * size[1] + Math.abs(rot[5]) * size[2]) / 2
    case 'sphere': return size[0]
    // long axis along local y; a capsule adds a cap of `radius` at each end
    default: {
      const along = Math.abs(rot[4]), r = size[1]
      return (along * size[0]) / 2 + (shape === 'capsule' ? r : r * Math.sqrt(Math.max(0, 1 - along * along)))
    }
  }
}

