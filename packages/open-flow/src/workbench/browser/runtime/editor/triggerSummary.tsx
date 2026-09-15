import type { TriggerDisplay } from '../../../../control/common/triggerCatalog.ts'
import type { TriggerNode } from '../api.ts'
import type { TriggerCatalogStore } from '../stores/triggerCatalog.ts'

import { useEffect } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { schemaObject, triggerPayloadSchema } from '../../../../flow/common/schema.ts'

export function TriggerSummary({ trigger, display }: { readonly trigger: TriggerNode; readonly display?: TriggerDisplay }) {
  const t = useTranslate()
  if (trigger.kind === 'manual') {
    return <p className="m-0 px-3 py-2 text-xs text-muted-foreground">{t('triggerSummary.manualPayloadHint')}</p>
  }
  if (trigger.kind === 'cron') return null
  const schema = schemaObject(triggerPayloadSchema(trigger))
  const type = schema?.type
  const payloadType = typeof type === 'string' ? type : Array.isArray(type) ? type.join(' | ') : 'JSON'
  const source = trigger.kind === 'integration' || trigger.kind === 'poll' ? trigger.definition.provider : undefined
  return (
    <section className="inspector-section">
      {(trigger.kind === 'integration' || trigger.kind === 'poll') && <p>{display?.description ?? trigger.definition.description}</p>}
      {source != null && <p className="text-sm text-muted-foreground">{source}</p>}
      <div className="flex items-center justify-between gap-3 text-sm">
        <code>payload</code>
        <span className="text-muted-foreground">{payloadType}</span>
      </div>
    </section>
  )
}

export function TriggerInspectorSummary({ trigger, catalog }: { readonly trigger: TriggerNode; readonly catalog: TriggerCatalogStore }) {
  const language = useLang()
  const state = useVal(catalog.state)
  const provider = trigger.kind == 'integration' || trigger.kind == 'poll'
  useEffect(() => {
    if (provider) catalog.get()
  }, [catalog, provider, language])
  return <TriggerSummary trigger={trigger} display={provider ? state.data?.display[trigger.definition.key] : undefined} />
}
