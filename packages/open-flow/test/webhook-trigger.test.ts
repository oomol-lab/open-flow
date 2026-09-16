import { describe, expect, it } from 'vitest'
import { maximumWebhookBodyBytes, webhookEndpointId, webhookOccurrenceId } from '../src/trigger/common/webhook.ts'

describe('Webhook Trigger protocol', () => {
  it('parses only canonical endpoint paths', () => {
    expect(webhookEndpointId(new URL('https://flow.example/v1/webhooks/endpoint_0123456789abcdef0123456789abcdef'))).toBe(
      'endpoint_0123456789abcdef0123456789abcdef',
    )
    expect(webhookEndpointId(new URL('https://flow.example/v1/webhooks/endpoint_0123456789ABCDEF0123456789ABCDEF'))).toBeUndefined()
    expect(webhookEndpointId(new URL('https://flow.example/v1/webhooks/endpoint_0123456789abcdef0123456789abcdef/'))).toBeUndefined()
  })

  it('versions the keyed occurrence identity', async () => {
    await expect(webhookOccurrenceId('endpoint_0123456789abcdef0123456789abcdef', 7, 'delivery-1')).resolves.toBe(
      '6a671295c7f20d463ae19b712f85b5e2b669f3f917f3287751243979e8a5ad7e',
    )
  })

  it('rejects invalid keys and creates opaque unkeyed identities', async () => {
    await expect(webhookOccurrenceId('endpoint_0123456789abcdef0123456789abcdef', 1, '   ')).resolves.toBeUndefined()
    await expect(webhookOccurrenceId('endpoint_0123456789abcdef0123456789abcdef', 1, 'x'.repeat(257))).resolves.toBeUndefined()
    await expect(webhookOccurrenceId('endpoint_0123456789abcdef0123456789abcdef', 1, null)).resolves.toMatch(/^webhook_[0-9a-f]{32}$/)
    expect(maximumWebhookBodyBytes).toBe(64 * 1024)
  })
})
