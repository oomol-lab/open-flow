import type { TriggerBinding } from '../api.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { triggerBinding } from '../../../../control/common/triggerDecoders.ts'
import { createI18n } from '../i18n.ts'
import { ListenerHealth, TriggerStatus } from './liveTriggers.tsx'

const binding: TriggerBinding = {
  flowId: 'flow',
  triggerNodeId: 'watch',
  currentPublicationId: 'live',
  health: 'failed',
  listener: { health: 'healthy' },
  kind: 'integration',
  runtimeVersion: 1,
  updatedAt: '2026-09-11T00:00:00Z',
  version: 1,
}

describe('Listener health projection', () => {
  it('preserves independent health through the public response decoder', () => {
    expect(triggerBinding(binding)).toEqual(binding)
    expect(() => triggerBinding({ ...binding, listener: { health: 'unknown' } })).toThrow()
    expect(() => triggerBinding({ ...binding, listener: { health: 'healthy', lastErrorCode: 42 } })).toThrow()
    const { listener: _, ...legacy } = binding
    expect(triggerBinding(legacy)).toEqual(legacy)
  })

  it.each([
    { input: binding, enabled: true, label: 'Scanning; notifications unavailable', detail: 'Periodic checks' },
    { enabled: true, input: { ...binding, health: 'healthy', listener: { health: 'failed' } }, label: 'Failed', detail: 'Saved progress' },
    { input: binding, enabled: false, label: 'Suspended', detail: null },
    { enabled: true, input: { ...binding, currentPublicationId: undefined }, label: 'Retired', detail: null },
  ] as const)('shows $label with Flow-wide enablement', ({ input, enabled, label, detail }) => {
    const i18n = createI18n('en')
    try {
      const output = renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
          <TriggerStatus binding={input} enabled={enabled} />
          <ListenerHealth binding={input} enabled={enabled} />
        </I18nProvider>,
      )
      expect(output).toContain(label)
      if (detail == null) expect(output).not.toContain('Periodic checks')
      else expect(output).toContain(detail)
    } finally {
      i18n.dispose()
    }
  })
})
