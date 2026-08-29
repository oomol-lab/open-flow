import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLlm, oomolLlm } from '../node/llm.ts'

afterEach(() => vi.unstubAllGlobals())

describe('OOMOL LLM host', () => {
  it('uses an explicitly configured LLM origin and token', async () => {
    let request: { readonly authorization: string | null; readonly url: string } | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        request = { authorization: new Headers(init?.headers).get('authorization'), url: String(input) }
        return Response.json({ choices: [{ message: { content: 'Configured' } }] })
      }),
    )
    const llm = createLlm('https://models.example.com', 'model-token')

    await llm({
      input: { messages: null, model: {}, template: [{ content: 'Answer.', role: 'user' }] },
      invocationId: 'invocation-explicit',
      mode: 'chat',
      signal: new AbortController().signal,
      version: 1,
    })

    expect(request).toEqual({ authorization: 'Bearer model-token', url: 'https://models.example.com/v1/chat/completions' })
  })

  it('derives the production LLM endpoint and projects a chat completion', async () => {
    let request: { readonly body: unknown; readonly headers: Headers; readonly url: string } | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        request = {
          body: JSON.parse(String(init?.body)) as unknown,
          headers: new Headers(init?.headers),
          url: String(input),
        }
        return Response.json({ choices: [{ message: { content: 'Hello back' } }] })
      }),
    )
    const llm = oomolLlm('https://connector.oomol.com', 'runtime-token')!

    await expect(
      llm({
        input: {
          input: 'Ada',
          messages: [{ content: 'Be concise.', role: 'system' }],
          model: { max_tokens: 128, model: 'deepseek-v4-flash', temperature: 0.4, top_p: 0.8 },
          template: [{ content: 'Hello {{ input }}: {{ count }}', role: 'user' }],
          count: 2,
        },
        invocationId: 'invocation-1',
        mode: 'chat',
        signal: new AbortController().signal,
        version: 1,
      }),
    ).resolves.toEqual({ kind: 'completed', value: { output: 'Hello back' }, version: 1 })
    expect(request).toEqual({
      body: {
        max_tokens: 128,
        messages: [
          { content: 'Be concise.', role: 'system' },
          { content: 'Hello Ada: 2', role: 'user' },
        ],
        model: 'deepseek-v4-flash',
        temperature: 0.4,
        top_p: 0.8,
      },
      headers: expect.any(Headers),
      url: 'https://llm.oomol.com/v1/chat/completions',
    })
    expect(request?.headers.get('authorization')).toBe('Bearer runtime-token')
    expect(request?.headers.get('content-type')).toBe('application/json')
  })

  it('derives the development endpoint and parses structured output', async () => {
    let url: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        url = String(input)
        return Response.json({ choices: [{ message: { content: '{"answer":42}' } }] })
      }),
    )
    const llm = oomolLlm('https://connector.oomol.dev', 'runtime-token')!

    await expect(
      llm({
        input: { messages: null, model: {}, template: [{ content: 'Answer.', role: 'user' }] },
        invocationId: 'invocation-2',
        mode: 'json',
        signal: new AbortController().signal,
        version: 1,
      }),
    ).resolves.toEqual({ kind: 'completed', value: { output: { answer: 42 } }, version: 1 })
    expect(url).toBe('https://llm.oomol.dev/v1/chat/completions')
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'oomol-chat',
      response_format: { type: 'json_object' },
    })
  })

  it('fails invalid structured output without exposing the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ choices: [{ message: { content: 'not json' } }] })),
    )
    const llm = oomolLlm('https://connector.oomol.com', 'runtime-token')!

    await expect(
      llm({
        input: { messages: null, model: {}, template: [{ content: 'Answer.', role: 'user' }] },
        invocationId: 'invocation-3',
        mode: 'json',
        signal: new AbortController().signal,
        version: 1,
      }),
    ).resolves.toEqual({ code: 'llm.output-invalid', kind: 'failed', message: 'The model returned invalid JSON.', version: 1 })
  })

  it('does not infer an LLM host for a custom Connector or an empty token', () => {
    expect(oomolLlm('https://connector.example.com', 'runtime-token')).toBeUndefined()
    expect(oomolLlm('https://connector.oomol.com', '')).toBeUndefined()
    expect(oomolLlm(undefined, 'runtime-token')).toBeUndefined()
  })

  it('rejects unsafe or ambiguous explicit LLM settings', () => {
    expect(() => createLlm('http://models.example.com', 'model-token')).toThrow('OPEN_FLOW_LLM_ORIGIN')
    expect(() => createLlm('https://models.example.com/v1', 'model-token')).toThrow('OPEN_FLOW_LLM_ORIGIN')
    expect(() => createLlm('https://models.example.com', '')).toThrow('OPEN_FLOW_LLM_TOKEN')
  })
})
