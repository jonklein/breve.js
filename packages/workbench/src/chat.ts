import { diffStats, lineDiff, renderDiff } from './diff'
import type { Doc } from './projects'

interface Proposal {
  summary: string
  scene?: string
  script?: string
}

interface Entry {
  role: 'user' | 'assistant'
  text: string
  proposal?: Proposal & { state: 'pending' | 'applied' | 'dismissed'; before?: Doc; warnings: string[] }
  error?: boolean
}

interface ChatResponse {
  text: string
  proposal?: Proposal
  warnings: string[]
  model: string
  usage: { input: number; output: number }
}

export interface ChatDeps {
  project(): { id: string; name: string; scene: string; script: string }
  apply(doc: Doc): void
  scriptName(): string
}

const KEEP_TURNS = 12
const storeKey = (id: string) => `breve:chat:${id}`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** The assistant tab: a conversation whose replies can carry a reviewable change to the project. */
export class ChatPanel {
  private entries: Entry[] = []
  private projectId = ''
  private busy = false
  private log = el('div', 'chat-log')
  private input = el('textarea', 'chat-input')
  private send = el('button', 'chat-send', 'Send')
  private note = el('div', 'chat-note muted')
  private available = true

  constructor(private root: HTMLElement, private deps: ChatDeps) {
    this.input.rows = 2
    this.input.placeholder = 'Describe a change, or ask a question…  (Enter to send)'
    this.input.setAttribute('aria-label', 'Message to the assistant')
    const form = el('div', 'chat-form')
    form.append(this.input, this.send)
    this.root.append(this.log, this.note, form)
    this.send.addEventListener('click', () => this.submit())
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit() }
    })
  }

  async init(): Promise<void> {
    try {
      const s = (await (await fetch('/api/status')).json()) as { llm: boolean; model: string }
      this.available = s.llm
      this.note.textContent = s.llm ? `Model: ${s.model}` : ''
    } catch {
      this.available = false
    }
    this.render()
  }

  setProject(id: string): void {
    this.projectId = id
    try {
      this.entries = JSON.parse(localStorage.getItem(storeKey(id)) ?? '[]') as Entry[]
    } catch {
      this.entries = []
    }
    this.render()
  }

  private save(): void {
    // Proposals hold whole files; keep only the conversation, not the pending changes.
    const slim = this.entries.slice(-40).map((e) => (e.proposal ? { ...e, proposal: { summary: e.proposal.summary, state: 'dismissed' as const, warnings: [] } } : e))
    try { localStorage.setItem(storeKey(this.projectId), JSON.stringify(slim)) } catch { /* storage unavailable */ }
  }

  private history() {
    return this.entries
      .filter((e) => !e.error)
      .slice(-KEEP_TURNS)
      .map((e) => ({ role: e.role, text: e.text || e.proposal?.summary || '(changed the project)' }))
  }

  private async submit(): Promise<void> {
    const request = this.input.value.trim()
    if (!request || this.busy) return
    this.input.value = ''
    const history = this.history()
    this.entries.push({ role: 'user', text: request })
    this.busy = true
    this.render()
    const started = performance.now()
    const tick = window.setInterval(() => {
      this.note.textContent = `Thinking… ${Math.round((performance.now() - started) / 1000)}s`
    }, 500)
    try {
      const p = this.deps.project()
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ history, request, project: { name: p.name, scene: p.scene, script: p.script } }),
      })
      const data = (await r.json()) as ChatResponse & { error?: string }
      if (!r.ok) throw new Error(data.error ?? `request failed (${r.status})`)
      this.entries.push({
        role: 'assistant',
        text: data.text,
        proposal: data.proposal ? { ...data.proposal, state: 'pending', warnings: data.warnings } : undefined,
      })
      this.note.textContent = `${data.model} · ${data.usage.input.toLocaleString()} in, ${data.usage.output.toLocaleString()} out`
    } catch (e) {
      this.entries.push({ role: 'assistant', text: e instanceof Error ? e.message : String(e), error: true })
      this.note.textContent = ''
    } finally {
      clearInterval(tick)
      this.busy = false
      this.save()
      this.render()
    }
  }

  private render(): void {
    this.log.replaceChildren()
    if (!this.available) {
      const help = el('div', 'chat-help')
      help.append(
        el('p', undefined, 'The assistant needs an Anthropic API key.'),
        el('p', undefined, 'Create a file named .env in the project folder containing ANTHROPIC_API_KEY=your key, then restart npm run dev. The key stays on the local server and never reaches the browser.'),
      )
      this.log.append(help)
    } else if (!this.entries.length) {
      const hint = el('div', 'chat-help')
      hint.append(
        el('p', undefined, 'Ask for a change and review it before it is applied.'),
        el('p', 'muted', 'Try: "make the birds a bit faster", "add a predator rule", "color the cells by age in a different way", or "explain how this script works".'),
      )
      this.log.append(hint)
    }
    for (const e of this.entries) this.log.append(this.renderEntry(e))
    if (this.busy) this.log.append(el('div', 'msg assistant muted', 'Thinking…'))
    this.send.disabled = this.busy || !this.available
    this.input.disabled = !this.available
    this.log.scrollTop = this.log.scrollHeight
  }

  private renderEntry(e: Entry): HTMLElement {
    const box = el('div', `msg ${e.role}${e.error ? ' error' : ''}`)
    if (e.text) box.append(el('div', 'msg-text', e.text))
    if (e.proposal) box.append(this.renderProposal(e))
    return box
  }

  private renderProposal(e: Entry): HTMLElement {
    const p = e.proposal!
    const card = el('div', 'proposal')
    card.append(el('div', 'proposal-summary', p.summary))

    const current = this.deps.project()
    const base: Doc = p.before ?? { scene: current.scene, script: current.script }
    const files: [string, string, string | undefined][] = [
      ['scene.json', base.scene, p.scene],
      [this.deps.scriptName(), base.script, p.script],
    ]
    for (const [name, before, after] of files) {
      if (after === undefined) continue
      const d = lineDiff(before, after)
      const { added, removed } = diffStats(d)
      const det = el('details', 'file-diff')
      const sum = el('summary')
      sum.append(el('span', 'mono', name), el('span', 'add-count', ` +${added}`), el('span', 'del-count', ` −${removed}`))
      det.append(sum)
      if (added || removed) det.append(renderDiff(d))
      else det.append(el('div', 'muted', 'No changes to this file.'))
      card.append(det)
    }

    if (p.warnings.length) {
      const w = el('div', 'proposal-warn')
      w.append(el('div', undefined, 'Heads up, this change has problems:'), ...p.warnings.map((m) => el('div', 'mono', m)))
      card.append(w)
    }

    const actions = el('div', 'proposal-actions')
    if (p.state === 'pending') {
      const apply = el('button', undefined, 'Apply')
      apply.addEventListener('click', () => {
        const cur = this.deps.project()
        p.before = { scene: cur.scene, script: cur.script }
        this.deps.apply({ scene: p.scene ?? cur.scene, script: p.script ?? cur.script })
        p.state = 'applied'
        this.render()
      })
      const dismiss = el('button', undefined, 'Dismiss')
      dismiss.addEventListener('click', () => { p.state = 'dismissed'; this.render() })
      actions.append(apply, dismiss)
    } else if (p.state === 'applied') {
      const undo = el('button', undefined, 'Undo')
      undo.addEventListener('click', () => {
        if (p.before) this.deps.apply(p.before)
        p.state = 'dismissed'
        this.render()
      })
      actions.append(el('span', 'applied-tag', 'Applied'), undo)
    } else {
      actions.append(el('span', 'muted', 'Not applied'))
    }
    card.append(actions)
    return card
  }
}
