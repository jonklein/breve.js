import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/** The two example projects, verbatim, so the model copies the house style. */
function examples(): string {
  const index = JSON.parse(read(join(root, 'examples', 'index.json')) || '[]') as { id: string; scene: string; script: string }[]
  return index
    .map((e) => {
      const dir = join(root, 'examples', e.id)
      if (!existsSync(dir) || !readdirSync(dir).length) return ''
      return `<example id="${e.id}">\n<file name="${e.scene}">\n${read(join(dir, e.scene))}</file>\n<file name="${e.script}">\n${read(join(dir, e.script))}</file>\n</example>`
    })
    .filter(Boolean)
    .join('\n\n')
}

const INSTRUCTIONS = `You are the assistant built into the breve workbench, a browser tool for tinkering with 3D multi-agent simulations. The person using it edits a scene (scene.json) and a script (JavaScript) and sees the result run live. They may be a beginner, so keep scripts short, readable, and well named, with a comment explaining each idea.

How to work:
- If the person asks a question or wants an explanation, answer in plain text and do not call a tool.
- If they ask for a change, call the update_project tool with the COMPLETE new contents of every file you change, and a one or two sentence summary. Do not paste code into your text reply as well.
- Change as little as you need to. Keep the existing structure, formatting, and comments in anything they didn't ask you to change.
- For a plain numeric tweak (slower, bigger, more of them) change a param value in scene.json instead of editing the script.
- When you add behavior with a new number in it, make it a param in scene.json (with value, min, max, step) and read it as p.name in the script, so it gets a slider.
- Scripts are ES modules with no imports. Never use Math.random() or Date.now(); use ctx.random(). Prefer the group operations (neighbors.velocity.average(), neighbors.alive.sum()) to loops.
- scene.json must be valid JSON that follows the reference exactly: unknown properties are rejected, colors are hex, and every "$name" must be a declared param. Every entry in "metrics" must exist in the script's exported metrics.
- Keep the project's kind (free agents, lattice, or physics creatures with a body). You cannot switch kinds in place; if they want a different kind of simulation, explain that they should fork an example of that kind.
- You cannot see the simulation. Describe expected effects honestly rather than claiming you watched it run.`

export function systemPrompt(): string {
  return [
    INSTRUCTIONS,
    '<reference>\n' + read(join(root, 'docs', 'script-api.md')) + '\n</reference>',
    '<stdlib>\n' + read(join(root, 'docs', 'stdlib.md')) + '\n</stdlib>',
    '<examples>\n' + examples() + '\n</examples>',
  ].join('\n\n')
}

export interface ProjectFiles {
  name: string
  scene: string
  script: string
}

export function projectBlock(p: ProjectFiles): string {
  return `<project name=${JSON.stringify(p.name)}>\n<file name="scene.json">\n${p.scene}\n</file>\n<file name="script.js">\n${p.script}\n</file>\n</project>`
}
