import type { TriggerDisplay } from '../../../../control/common/triggerCatalog.ts'
import type { TriggerNode } from '../api.ts'

import { useTranslate } from 'val-i18n-react'
import { presentBuiltInTriggerOutputs } from './builtInOutputPresentation.ts'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'
import { presentProviderTriggerOutputs } from './providerTriggerPresentation.ts'

export function TriggerSummary({ trigger, display }: { readonly trigger: TriggerNode; readonly display?: TriggerDisplay }) {
  const t = useTranslate()
  const values =
    trigger.kind == 'integration' || trigger.kind == 'poll' ? presentProviderTriggerOutputs(trigger, display) : presentBuiltInTriggerOutputs(trigger, t)
  return (
    <section className="inspector-port-section" data-inspector-section="outputs">
      <PortDefinitionEditor layout="ports" title={t('inspector.ports.outputsTitle')} output disabled values={values} onChange={() => {}} />
    </section>
  )
}
