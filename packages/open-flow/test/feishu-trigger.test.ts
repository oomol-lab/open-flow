import { createCipheriv, createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { receiveFeishuEvent, matchesFeishuEvent } from '../src/trigger/providers/feishu/events.ts'

const now = Date.parse('2026-09-14T08:00:00.000Z')
const source = { appId: 'cli_test', verificationToken: 'verification-secret', encryptKey: 'encryption-secret' }

function request(value: unknown) {
  const iv = Buffer.alloc(16, 7)
  const cipher = createCipheriv('aes-256-cbc', createHash('sha256').update(source.encryptKey).digest(), iv)
  const encrypt = Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64')
  const raw = Buffer.from(JSON.stringify({ encrypt }))
  const timestamp = String(now / 1000)
  const signature = createHash('sha256')
    .update(timestamp + 'nonce' + source.encryptKey)
    .update(raw)
    .digest('hex')
  return { raw, headers: new Headers({ 'x-lark-request-timestamp': timestamp, 'x-lark-request-nonce': 'nonce', 'x-lark-signature': signature }) }
}

function event(overrides = {}) {
  return {
    schema: '2.0',
    header: {
      app_id: source.appId,
      tenant_key: 'tenant',
      token: source.verificationToken,
      event_id: 'delivery',
      event_type: 'im.message.receive_v1',
      create_time: String(now),
      ...overrides,
    },
    event: { message: { message_id: 'message', chat_id: 'chat', content: '{"text":"hello"}' } },
  }
}

describe('Feishu event boundary', () => {
  it('handles encrypted URL verification without requiring normal event headers', async () => {
    const { raw } = request({ token: source.verificationToken, type: 'url_verification', challenge: 'challenge' })
    await expect(receiveFeishuEvent(raw, new Headers(), source, now)).resolves.toEqual({ challenge: 'challenge' })
  })

  it('authenticates the original bytes and uses message identity across envelope redeliveries', async () => {
    const first = request(event())
    const second = request(event({ event_id: 'another-delivery' }))
    const parsed = await receiveFeishuEvent(first.raw, first.headers, source, now)
    expect(parsed).toEqual(await receiveFeishuEvent(second.raw, second.headers, source, now))
    if (!('event' in parsed)) throw new Error('Expected an event')
    expect(parsed.event.id).toBe('im.message.receive_v1:message')
    expect(JSON.stringify(parsed)).not.toContain(source.verificationToken)
    expect(matchesFeishuEvent({ eventTypes: ['im.message.receive_v1'], chatIds: ['chat'] }, parsed.event)).toBe(true)
    expect(matchesFeishuEvent({ eventTypes: ['im.message.receive_v1'], chatIds: ['other'] }, parsed.event)).toBe(false)
    await expect(receiveFeishuEvent(Buffer.from(first.raw.toString() + ' '), first.headers, source, now)).rejects.toThrow('signature')
  })

  it.each(['tenant-a', 'tenant-b'])('accepts authenticated events from tenant %s and preserves their tenant metadata', async (tenantKey) => {
    const { raw, headers } = request(event({ tenant_key: tenantKey }))
    await expect(receiveFeishuEvent(raw, headers, source, now)).resolves.toMatchObject({ event: { appId: source.appId, tenantKey } })
  })

  it.each([{ app_id: 'cli_other' }, { tenant_key: 42 }, { tenant_key: '' }, { token: 'wrong' }, { event_type: 'card.action.trigger' }])(
    'rejects invalid authority or synchronous callbacks: %j',
    async (overrides) => {
      const { raw, headers } = request(event(overrides))
      await expect(receiveFeishuEvent(raw, headers, source, now)).rejects.toThrow()
    },
  )

  it('rejects unsigned events, stale signatures, wrong keys and malformed encrypted bodies', async () => {
    const { raw, headers } = request(event())
    await expect(receiveFeishuEvent(raw, new Headers(), source, now)).rejects.toThrow()
    await expect(receiveFeishuEvent(raw, headers, source, now + 2 * 86_400_000)).rejects.toThrow()
    await expect(receiveFeishuEvent(raw, headers, { ...source, encryptKey: 'wrong' }, now)).rejects.toThrow()
    await expect(receiveFeishuEvent(Buffer.from('{"encrypt":"AAAA"}'), headers, source, now)).rejects.toThrow()
  })

  it('preserves distinct legacy approval events and removes envelope authentication data', async () => {
    const { raw, headers } = request({
      uuid: 'approval-delivery',
      ts: String(now),
      token: source.verificationToken,
      event: {
        type: 'approval_instance',
        app_id: source.appId,
        tenant_key: 'tenant',
        approval_code: 'approval',
        instance_code: 'instance',
        status: 'APPROVED',
      },
    })
    const parsed = await receiveFeishuEvent(raw, headers, source, now)
    expect(parsed).toMatchObject({ event: { id: 'approval_instance:approval-delivery', body: { status: 'APPROVED' } } })
  })
})
