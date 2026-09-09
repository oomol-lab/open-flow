import type { TriggerNode } from '../api.ts'

import { useTranslate } from 'val-i18n-react'
import { schemaObject, triggerPayloadSchema } from '../../../../flow/common/schema.ts'

export function TriggerSummary({ trigger }: { readonly trigger: TriggerNode }) {
  const t = useTranslate()
  const schema = schemaObject(triggerPayloadSchema(trigger))
  const type = schema?.type
  const payloadType = typeof type === 'string' ? type : Array.isArray(type) ? type.join(' | ') : 'JSON'
  const source = trigger.kind === 'integration' || trigger.kind === 'poll' ? trigger.definition.provider : undefined
  return (
    <section className="inspector-section">
      {trigger.kind === 'manual' && <p>{t('triggerSummary.manualSummary')}</p>}
      {trigger.kind === 'integration' && <p>{t('triggerSummary.integrationSummary')}</p>}
      {source != null && <p className="text-sm text-muted-foreground">{source}</p>}
      <div className="flex items-center justify-between gap-3 text-sm">
        <code>payload</code>
        <span className="text-muted-foreground">{payloadType}</span>
      </div>
    </section>
  )
}
