import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { InvokeLlmTask, LlmTaskResult } from '@oomol-lab/open-flow/runtime-contract'

const defaultModel = 'oomol-chat'

export function createLlm(origin: string, token: string): InvokeLlmTask {
  const url = new URL(origin)
  const loopback = url.hostname == '127.0.0.1' || url.hostname == '::1' || url.hostname == '[::1]' || url.hostname == 'localhost'
  if (
    (url.protocol != 'https:' && !(url.protocol == 'http:' && loopback)) ||
    url.username != '' ||
    url.password != '' ||
    url.pathname != '/' ||
    url.search != '' ||
    url.hash != ''
  ) {
    throw new Error('OPEN_FLOW_LLM_ORIGIN must be an HTTPS origin without credentials, a path, query, or fragment, except on loopback.')
  }
  if (token.length == 0) throw new Error('OPEN_FLOW_LLM_TOKEN must not be empty.')
  return invokeLlm(new URL('v1/', url), token)
}

export function oomolLlm(connectorOrigin: string | undefined, token: string | undefined): InvokeLlmTask | undefined {
  if (connectorOrigin == null || token == null || token.length == 0) return
  const connector = new URL(connectorOrigin)
  if (connector.hostname != 'connector.oomol.com' && connector.hostname != 'connector.oomol.dev') return
  return createLlm(`https://llm.${connector.hostname.slice('connector.'.length)}`, token)
}

function invokeLlm(origin: URL, token: string): InvokeLlmTask {
  return async ({ input, mode, signal }) => {
    try {
      const model = record(input.model)
      const messages = [
        ...(input.messages == null ? [] : chatMessages(input.messages, (content) => content)),
        ...chatMessages(input.template, (content) => render(content, input)),
      ]
      const body: Record<string, unknown> = {
        messages,
        model: typeof model.model == 'string' && model.model.length > 0 ? model.model : defaultModel,
        ...(mode == 'json' ? { response_format: { type: 'json_object' } } : {}),
      }
      if (model.temperature != null) body.temperature = finite(model.temperature)
      if (model.top_p != null) body.top_p = finite(model.top_p)
      if (model.max_tokens != null) {
        if (!Number.isSafeInteger(model.max_tokens) || Number(model.max_tokens) <= 0) throw new TypeError('Invalid LLM max_tokens.')
        body.max_tokens = model.max_tokens
      }

      const response = await fetch(new URL('chat/completions', origin), {
        body: JSON.stringify(body),
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        method: 'POST',
        redirect: 'error',
        signal,
      })
      if (!response.ok) return unavailable()
      const source = record(await response.json())
      if (!Array.isArray(source.choices) || source.choices.length == 0) return unavailable()
      const choice = record(source.choices[0])
      const message = record(choice.message)
      if (typeof message.content != 'string') return unavailable()
      if (mode == 'chat') return { kind: 'completed', value: { output: message.content }, version: 1 }
      try {
        const output = record(JSON.parse(message.content) as unknown)
        return { kind: 'completed', value: { output: output as JsonValue }, version: 1 }
      } catch {
        return { code: 'llm.output-invalid', kind: 'failed', message: 'The model returned invalid JSON.', version: 1 }
      }
    } catch {
      if (signal.aborted) throw signal.reason
      return unavailable()
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) throw new TypeError('Expected an object.')
  return value as Record<string, unknown>
}

function finite(value: unknown): number {
  if (typeof value != 'number' || !Number.isFinite(value)) throw new TypeError('Expected a finite number.')
  return value
}

function chatMessages(value: unknown, transform: (content: string) => string): readonly { readonly content: string; readonly role: string }[] {
  if (!Array.isArray(value)) throw new TypeError('Expected LLM messages.')
  return value.map((candidate) => {
    const message = record(candidate)
    const role = message.role
    if (typeof role != 'string' || (role != 'system' && role != 'user' && role != 'assistant')) {
      throw new TypeError('Invalid LLM message role.')
    }
    if (typeof message.content != 'string') throw new TypeError('Invalid LLM message content.')
    return { content: transform(message.content), role }
  })
}

function render(template: string, input: Readonly<Record<string, JsonValue>>): string {
  return template.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, name: string) => {
    if (!Object.hasOwn(input, name)) return match
    const value = input[name]!
    return typeof value == 'string' ? value : JSON.stringify(value)
  })
}

function unavailable(): LlmTaskResult {
  return { code: 'llm.unavailable', kind: 'failed', message: 'The LLM request could not be completed.', version: 1 }
}
