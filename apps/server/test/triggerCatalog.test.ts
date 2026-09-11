import type { ControlService } from '../node/application/control-service.ts'

import { triggerDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import * as providers from '@oomol-lab/open-flow/provider-triggers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlError } from '../node/error.ts'
import { createControlApp } from '../node/transport/control.ts'

function setup() {
  const definitions = triggerDefinitions.map(({ snapshot }) => snapshot)
  const service = {
    listTriggerDefinitions: () => definitions,
    getTriggerKey: (key: string) => definitions.find((item) => item.key == key),
  } as unknown as ControlService
  return createControlApp(service, () => 'actor').onError((error) =>
    Response.json({ error: { message: error.message } }, { status: error instanceof ControlError ? error.status : 500 }),
  )
}

describe('Trigger catalog HTTP representations', () => {
  afterEach(() => vi.restoreAllMocks())
  it('returns localized copy alongside canonical definitions and revalidates with an ETag', async () => {
    const app = setup()
    const first = await app.request('/trigger-keys/catalog?locale=zh-CN')
    const body = await first.json()
    expect(first.status).toBe(200)
    expect(first.headers.get('content-language')).toBe('zh-CN')
    expect(first.headers.get('vary')).toContain('Accept-Language')
    expect(first.headers.get('cache-control')).toBe('private, no-cache')
    expect(body.definitions).toEqual(triggerDefinitions.map(({ snapshot }) => snapshot))
    expect(body.display[body.definitions[0].key].displayName).not.toBe(body.definitions[0].displayName)
    const etag = first.headers.get('etag')!
    expect(etag).toBeTruthy()
    const next = await app.request('/trigger-keys/catalog?locale=zh-CN', { headers: { 'if-none-match': etag } })
    expect(next.status).toBe(304)
    expect(await next.text()).toBe('')
    expect(next.headers.get('content-language')).toBe('zh-CN')
    const english = await app.request('/trigger-keys/catalog?locale=en', { headers: { 'if-none-match': etag } })
    expect(english.status).toBe(200)
    expect(english.headers.get('etag')).not.toBe(etag)
  })

  it('negotiates summary language while detail definitions stay canonical', async () => {
    const app = setup()
    const response = await app.request('/trigger-keys', { headers: { 'Accept-Language': 'ja' } })
    expect(response.headers.get('content-language')).toBe('ja')
    const { keys } = await response.json()
    expect(keys[0].displayName).not.toBe(triggerDefinitions[0]!.snapshot.displayName)
    const detail = await app.request(`/trigger-keys/${keys[0].key}`, { headers: { 'Accept-Language': 'ja' } })
    expect((await detail.json()).definition).toEqual(triggerDefinitions[0]!.snapshot)
  })
  it('invalidates the ETag when only translated copy changes', async () => {
    const app = setup()
    const first = await app.request('/trigger-keys/catalog?locale=zh-CN')
    const before = await first.json()
    const original = providers.localizeTrigger
    vi.spyOn(providers, 'localizeTrigger').mockImplementation(async (definition, locale) => {
      const copy = await original(definition, locale)
      return { ...copy, description: copy.description + ' Updated.' }
    })
    const changed = await app.request('/trigger-keys/catalog?locale=zh-CN', { headers: { 'if-none-match': first.headers.get('etag')! } })
    expect(changed.status).toBe(200)
    expect(changed.headers.get('etag')).not.toBe(first.headers.get('etag'))
    expect((await changed.json()).definitions).toEqual(before.definitions)
  })

  it('prioritizes explicit locale, falls back for unsupported languages and rejects invalid queries', async () => {
    const app = setup()
    for (const [query, expected] of [
      ['zh-Hant-HK', 'zh-TW'],
      ['de', 'en'],
    ]) {
      const response = await app.request(`/trigger-keys?locale=${query}`, { headers: { 'Accept-Language': 'ja' } })
      expect(response.headers.get('content-language')).toBe(expected)
    }
    expect((await app.request('/trigger-keys?locale=bad_tag')).status).toBe(400)
    expect((await app.request('/trigger-keys/catalog?locale=')).status).toBe(400)
  })
})
