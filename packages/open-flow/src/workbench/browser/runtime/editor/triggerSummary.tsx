import type { TriggerNode } from '../api.ts'

import { useTranslate } from 'val-i18n-react'
import { presentBuiltInTriggerOutputs } from './builtInOutputPresentation.ts'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'

export function TriggerSummary({ trigger }: { readonly trigger: TriggerNode }) {
  const t = useTranslate()
  return (
    <section className="inspector-port-section" data-inspector-section="outputs">
      <PortDefinitionEditor
        layout="ports"
        title={t('inspector.ports.outputsTitle')}
        output
        disabled
        values={presentBuiltInTriggerOutputs(trigger, t)}
        onChange={() => {}}
      />
    </section>
  )
}
