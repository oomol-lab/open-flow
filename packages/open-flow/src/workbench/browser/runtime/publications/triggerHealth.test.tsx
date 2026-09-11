import type { TriggerBinding } from '../api.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { triggerBinding } from '../../../../control/common/triggerDecoders.ts'
import { createI18n } from '../i18n.ts'
import { ListenerHealth, TriggerStatus } from './publicationsView.tsx'

const binding: TriggerBinding = {
  flowId: 'flow',
  triggerNodeId: 'watch',
  currentPublicationId: 'live',
  health: 'failed',
  listener: { health: 'healthy' },
  kind: 'integration',
  operatorState: 'active',
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
    { input: binding, label: 'Scanning; notifications unavailable', detail: 'Periodic checks' },
    { input: { ...binding, health: 'healthy', listener: { health: 'failed' } }, label: 'Failed', detail: 'Saved progress' },
    { input: { ...binding, operatorState: 'paused' }, label: 'Suspended', detail: null },
    { input: { ...binding, currentPublicationId: undefined }, label: 'Retired', detail: null },
  ] as const)('shows $label without overriding operator state', ({ input, label, detail }) => {
    const i18n = createI18n('en')
    try {
      const output = renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
          <TriggerStatus binding={input} />
          <ListenerHealth binding={input} />
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
