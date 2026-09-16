import type { TriggerDisplay } from '../../../../control/common/triggerCatalog.ts'
import type { TriggerNode } from '../api.ts'
import type { TriggerCatalogStore } from '../stores/triggerCatalog.ts'

import { useEffect } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { schemaObject } from '../../../../flow/common/schema.ts'
import { triggerOutputDefinitions } from '../../../../trigger/common/contract.ts'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'

export function TriggerSummary({ trigger, display }: { readonly trigger: TriggerNode; readonly display?: TriggerDisplay }) {
  const t = useTranslate()
  if (trigger.kind === 'manual') {
    return (
      <section className="inspector-port-section" data-inspector-section="outputs">
        <PortDefinitionEditor
          layout="ports"
          title={t('inspector.ports.outputsTitle')}
          output
          disabled
          values={triggerOutputDefinitions(trigger)}
          onChange={() => {}}
        />
      </section>
    )
  }
  const source = trigger.kind === 'integration' || trigger.kind === 'poll' ? trigger.definition.provider : undefined
  return (
    <section className="inspector-section">
      {(trigger.kind === 'integration' || trigger.kind === 'poll') && <p>{display?.description ?? trigger.definition.description}</p>}
      {source != null && <p className="text-sm text-muted-foreground">{source}</p>}
      {triggerOutputDefinitions(trigger).map((port) => {
        const type = schemaObject(port.jsonSchema)?.type
        return (
          <div key={port.handle} className="flex items-center justify-between gap-3 text-sm">
            <code>{port.handle}</code>
            <span className="text-muted-foreground">{typeof type === 'string' ? type : Array.isArray(type) ? type.join(' | ') : 'JSON'}</span>
          </div>
        )
      })}
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
