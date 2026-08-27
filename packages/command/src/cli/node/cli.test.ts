import type { UiLanguage } from '@oomol-lab/open-flow/localization'

import { uiLanguages } from '@oomol-lab/open-flow/localization'
import { describe, expect, it, vi } from 'vitest'
import { runCli } from './cli.ts'
import { locales } from './i18n.ts'

/** Reads one help message straight from the locale bundle the CLI ships. */
function helpMessage(language: UiLanguage, key: 'options' | 'title'): string {
  const help = locales[language].help
  if (typeof help == 'string') throw new Error(`Locale ${language} must nest help messages.`)
  return String(help[key])
}

const flow = {
  createdAt: '2026-08-14T00:00:00.000Z',
  draftRevisionId: 'revision-1',
  flowId: 'flow-1',
  name: 'Main',
  status: 'active',
  updatedAt: '2026-08-14T00:00:00.000Z',
  version: 1,
} as const

function runtime(language: UiLanguage = 'en') {
  let stdout = ''
  let stderr = ''
  const opened: string[] = []
  return {
    opened,
    stderr: () => stderr,
    stdout: () => stdout,
    value: {
      env: {},
      language,
      openUrl: async (url: string) => void opened.push(url),
      readFile: async () => '',
      readStdin: async () => '',
      stderr: { write: (value: string) => (stderr += value) },
      stdout: { write: (value: string) => (stdout += value) },
      wait: async () => {},
    },
  }
}

describe('CLI', () => {
  it('prints help without making a Control API request', async () => {
    const output = runtime()
    const request = vi.fn()

    await expect(runCli([], { request }, output.value)).resolves.toBe(0)

    expect(output.stdout()).toContain('Open Flow commands')
    expect(request).not.toHaveBeenCalled()
  })

  it('prints the full command listing in every supported language', async () => {
    for (const language of uiLanguages) {
      const output = runtime(language)

      await expect(runCli([], { request: vi.fn() }, output.value)).resolves.toBe(0)

      const text = output.stdout()
      expect([language, text.includes(helpMessage(language, 'title'))]).toEqual([language, true])
      expect([language, text.includes('  oo flow list')]).toEqual([language, true])
      expect([language, text.includes(helpMessage(language, 'options'))]).toEqual([language, true])
    }
  })

  it('prints the localized usage line for a code subcommand', async () => {
    const output = runtime('fr')

    await expect(runCli(['code', 'list', '--help'], { request: vi.fn() }, output.value)).resolves.toBe(0)

    expect(output.stdout()).toBe('Utilisation : oo flow code list <flow> [--json]\n')
  })

  it('creates a top-level Flow through POST /v1/flows', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe('/v1/flows')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ name: 'Main', version: 1 })
      expect(new Headers(init?.headers).has('idempotency-key')).toBe(true)
      return Response.json(flow, { status: 201 })
    })

    await expect(runCli(['create', 'Main', '--json'], { request }, output.value)).resolves.toBe(0)

    expect(JSON.parse(output.stdout())).toEqual({ flow, kind: 'flow.create', version: 1 })
    expect(request).toHaveBeenCalledOnce()
  })

  it('lists top-level Flows without Project context', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string) => {
      expect(path).toBe('/v1/flows?limit=100')
      return Response.json({ flows: [flow], version: 1 })
    })

    await expect(runCli(['list', '--json'], { request }, output.value)).resolves.toBe(0)

    expect(JSON.parse(output.stdout())).toEqual({ flows: [flow], kind: 'flow.list', version: 1 })
  })

  it('checks the selected Flow Draft revision', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/Main') return Response.json({ error: { code: 'flow.not-found', message: 'Missing.' }, version: 1 }, { status: 404 })
      if (path == '/v1/flows?limit=100') return Response.json({ flows: [flow], version: 1 })
      if (path == '/v1/flows/flow-1/revisions/revision-1/check') {
        return Response.json({
          closureDigest: 'closure-1',
          diagnostics: [],
          engineContract: 'open-flow-engine/v1',
          flowId: flow.flowId,
          modelVersion: 1,
          revisionDigest: 'digest-1',
          revisionId: flow.draftRevisionId,
          valid: true,
          version: 1,
        })
      }
      throw new Error(path)
    })

    await expect(runCli(['check', 'Main', '--json'], { request }, output.value)).resolves.toBe(0)
    expect(JSON.parse(output.stdout())).toMatchObject({ check: { flowId: 'flow-1', valid: true }, kind: 'flow.check' })
  })

  it('rejects invalid Flow names before making a request', async () => {
    const output = runtime()
    const request = vi.fn()

    await expect(runCli(['create', 'flow&&', '--json'], { request }, output.value)).resolves.toBe(1)

    expect(JSON.parse(output.stderr())).toMatchObject({ error: { code: 'cli.invalid-arguments' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('does not expose the removed Project command', async () => {
    const output = runtime()
    const request = vi.fn()

    await expect(runCli(['project', 'list', '--json'], { request }, output.value)).resolves.toBe(1)

    expect(JSON.parse(output.stderr())).toMatchObject({ error: { code: 'cli.invalid-arguments' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('opens a Flow-scoped Workbench URL', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string) =>
      path == '/v1/flows/Main'
        ? Response.json({ error: { code: 'flow.not-found', message: 'Missing.' }, version: 1 }, { status: 404 })
        : Response.json({ flows: [flow], version: 1 }),
    )
    const getWorkbenchUrl = vi.fn(async (flowId?: string) => `https://console.example/flows/${flowId ?? ''}`)

    await expect(runCli(['open', 'Main'], { getWorkbenchUrl, request }, output.value)).resolves.toBe(0)

    expect(getWorkbenchUrl).toHaveBeenCalledWith(flow.flowId)
    expect(output.opened).toEqual(['https://console.example/flows/flow-1'])
  })
})
