import type { ConnectorProxy } from '../src/connector/common/proxy.ts'
import type { JsonValue } from '../src/flow/common/change.ts'
import type { IntegrationStateContext } from '../src/trigger/common/integration.ts'

import { describe, expect, it } from 'vitest'
import { githubPullRequestListener as definition } from '../src/trigger/providers/github/watch-pull-request.ts'

const config = { owner: 'oomol-lab', repo: 'open-flow', number: 114 }
const now = new Date('2026-09-11T00:00:00Z')
const pullRequest = {
  id: 123,
  number: 114,
  title: 'Change',
  html_url: 'https://github.com/oomol-lab/open-flow/pull/114',
  state: 'open',
  draft: true,
  merged: false,
  updated_at: now.toISOString(),
  head: { sha: 'head' },
  base: { sha: 'base' },
}

async function setup() {
  let checkpoint: JsonValue = null
  let subscription: Readonly<Record<string, JsonValue>> = {}
  const state: IntegrationStateContext = {
    get checkpoint() {
      return checkpoint
    },
    get subscription() {
      return subscription
    },
    async saveCheckpoint(value) {
      checkpoint = value
    },
    async saveSubscription(value) {
      subscription = value
    },
  }
  const connector: ConnectorProxy = {
    execute: async (request) =>
      request.method == 'POST' ? { status: 201, data: { id: 1 } } : { status: 200, data: request.endpoint.endsWith('/pulls/114') ? pullRequest : {} },
  }
  await definition.reconcile({
    active: true,
    config,
    connector,
    state,
    now,
    endpointUrl: 'https://flow.test/callback',
    callbackSecret: 'secret',
    idempotencyKey: 'prepare',
  })
  return { state, connector }
}

describe('GitHub pull request listener', () => {
  it('baselines without delivering current state, then detects changes without a notification', async () => {
    const { state, connector } = await setup()
    const first = await definition.listener!.read({ checkpoint: state.checkpoint, config, connector, now })
    expect(first.payload).toBeNull()
    const changed: ConnectorProxy = { execute: async () => ({ status: 200, data: { ...pullRequest, draft: false, head: { sha: 'next' } } }) }
    const next = await definition.listener!.read({ checkpoint: state.checkpoint, config, connector: changed, now })
    expect(next.payload).toMatchObject({ pullRequest: { number: 114, draft: false, headSha: 'next' } })
    expect(await definition.listener!.read({ checkpoint: state.checkpoint, config, connector: changed, now })).toEqual(next)
    expect((await definition.listener!.read({ checkpoint: next.checkpoint, config, connector: changed, now })).payload).toBeNull()
    const returned = await definition.listener!.read({ checkpoint: next.checkpoint, config, connector, now })
    expect(returned.payload).toMatchObject({ pullRequest: { draft: true } })
    expect(returned.dedupeKey).not.toEqual(first.dedupeKey)
  })

  it('keeps the baseline after subscription creation fails', async () => {
    const { state, connector } = await setup()
    const checkpoint = state.checkpoint
    await expect(
      definition.reconcile({
        active: true,
        config,
        connector: {
          execute: async () => {
            throw new Error('offline')
          },
        },
        state,
        now,
        endpointUrl: 'https://flow.test/callback',
        callbackSecret: 'secret',
        idempotencyKey: 'renew',
      }),
    ).rejects.toThrow()
    expect(state.checkpoint).toEqual(checkpoint)
    expect((await definition.listener!.read({ checkpoint, config, connector, now })).payload).toBeNull()
  })

  it.each([401, 403, 404, 429, 500])('does not reset progress after HTTP %s', async (status) => {
    const { state } = await setup()
    const checkpoint = state.checkpoint
    await expect(definition.listener!.read({ checkpoint, config, connector: { execute: async () => ({ status, data: {} }) }, now })).rejects.toThrow()
    expect(state.checkpoint).toEqual(checkpoint)
  })

  it('rejects malformed source data and propagates cancellation', async () => {
    const { state } = await setup()
    await expect(
      definition.listener!.read({
        checkpoint: state.checkpoint,
        config,
        connector: { execute: async () => ({ status: 200, data: { ...pullRequest, head: null } }) },
        now,
      }),
    ).rejects.toThrow('invalid pull request')
    const controller = new AbortController()
    const connector: ConnectorProxy = {
      execute: async (_request, signal) => {
        expect(signal).toBe(controller.signal)
        controller.abort(new Error('canceled'))
        return { status: 200, data: pullRequest }
      },
    }
    await expect(definition.listener!.read({ checkpoint: state.checkpoint, config, connector, now, signal: controller.signal })).rejects.toThrow('canceled')
  })

  it('verifies signatures and wakes only for the selected pull request', async () => {
    const { state, connector } = await setup()
    async function receive(number: number, authenticated: boolean) {
      const payload = { number }
      const rawBody = new TextEncoder().encode(JSON.stringify(payload))
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody))
      const headers: Record<string, string> = {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=' + (authenticated ? [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('') : 'invalid'),
      }
      return definition.receive({
        admit: true,
        bindingId: 'binding',
        callbackSecret: 'secret',
        config,
        connector,
        current: true,
        header: (name) => headers[name],
        method: 'POST',
        now,
        payload,
        rawBody,
        query: () => undefined,
        state,
      })
    }
    expect(await receive(114, false)).toMatchObject({ outcome: 'respond', status: 404 })
    expect(await receive(115, true)).toMatchObject({ outcome: 'ignored' })
    const checkpoint = state.checkpoint
    expect(await receive(114, true)).toEqual({ outcome: 'wake' })
    expect(state.checkpoint).toEqual(checkpoint)
  })
})
