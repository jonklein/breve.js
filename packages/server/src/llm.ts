import Anthropic from '@anthropic-ai/sdk'
import { problemsWith } from './validate'
import { projectBlock, systemPrompt, type ProjectFiles } from './prompt'

export const MODEL = process.env.BREVE_MODEL || 'claude-opus-5-5'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const MAX_REPAIRS = 2

export interface Turn {
  role: 'user' | 'assistant'
  text: string
}

export interface Proposal {
  summary: string
  scene?: string
  script?: string
}

export interface ChatResult {
  text: string
  proposal?: Proposal
  model: string
  usage: { input: number; output: number }
  /** Problems that remained after the repair attempts. */
  warnings: string[]
}

const UPDATE_TOOL = {
  name: 'update_project',
  description:
    'Replace the contents of the current project files. Pass the complete new text of each file you change, and leave out the files you do not change.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: { type: 'string', description: 'One or two plain sentences saying what changed and what the person should notice.' },
      scene: { type: 'string', description: 'The complete new contents of scene.json.' },
      script: { type: 'string', description: 'The complete new contents of the script.' },
    },
    required: ['summary'],
    additionalProperties: false,
  },
}

let cached: Anthropic | null = null
function client(): Anthropic {
  return (cached ??= new Anthropic())
}

export function configured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
}

type Message = Anthropic.Beta.BetaMessage
type Param = Anthropic.Beta.BetaMessageParam

async function ask(messages: Param[], withFallback: boolean): Promise<Message> {
  const params = {
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
    tools: [UPDATE_TOOL],
    tool_choice: { type: 'auto' },
    messages,
    ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
  }
  // Streaming keeps long generations from hitting HTTP timeouts; we only need the final message.
  return client().beta.messages.stream(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming).finalMessage()
}

export async function chat(history: Turn[], request: string, project: ProjectFiles): Promise<ChatResult> {
  const messages: Param[] = [
    ...history.map((t): Param => ({ role: t.role, content: t.text })),
    { role: 'user', content: `${projectBlock(project)}\n\n${request}` },
  ]
  const usage = { input: 0, output: 0 }
  let withFallback = true
  let warnings: string[] = []

  for (let round = 0; ; round++) {
    let msg: Message
    try {
      msg = await ask(messages, withFallback)
    } catch (e) {
      // If the fallback option is what the API objected to, retry once without it.
      if (withFallback && e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
        withFallback = false
        round--
        continue
      }
      throw e
    }
    usage.input += msg.usage.input_tokens
    usage.output += msg.usage.output_tokens

    if (msg.stop_reason === 'refusal') {
      return { text: 'The model declined this request. Try rephrasing it.', model: msg.model, usage, warnings }
    }

    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim()
    const call = msg.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === UPDATE_TOOL.name)
    if (!call) {
      const note = msg.stop_reason === 'max_tokens' ? '\n\n(The reply was cut off. Ask for a smaller change.)' : ''
      return { text: text + note || 'No response.', model: msg.model, usage, warnings }
    }

    const input = call.input as { summary?: unknown; scene?: unknown; script?: unknown }
    const proposal: Proposal = {
      summary: typeof input.summary === 'string' ? input.summary : 'Proposed changes',
      ...(typeof input.scene === 'string' ? { scene: input.scene } : {}),
      ...(typeof input.script === 'string' ? { script: input.script } : {}),
    }
    warnings = problemsWith(proposal)
    if (!warnings.length || round >= MAX_REPAIRS) return { text, proposal, model: msg.model, usage, warnings }

    // Show the model its own mistakes and let it fix them.
    messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] })
    messages.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: call.id,
        is_error: true,
        content: `The change was rejected before it reached the person:\n${warnings.join('\n')}\nFix every problem and call update_project again with the complete files.`,
      }],
    })
  }
}

/** The small, fast model that answers `ctx.ask` from simulated characters. Override with BREVE_DECIDE_MODEL. */
export const DECIDE_MODEL = process.env.BREVE_DECIDE_MODEL || 'claude-haiku-5-5'

/** One short question from a script's `think`: returns the model's reply as text. */
export async function decide(prompt: string, json: boolean, images: string[] = []): Promise<string> {
  const msg = await client().messages.create({
    model: DECIDE_MODEL,
    max_tokens: 400,
    system: 'You decide what one character in a simulation does next. Answer briefly and exactly in the form the question asks for.' + (json ? ' Reply with a single JSON value and nothing else.' : ''),
    messages: [{
      role: 'user',
      // pictures first, then the question about them
      content: images.length
        ? [...images.map((data) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data } })), { type: 'text' as const, text: prompt }]
        : prompt,
    }],
  })
  return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
}
