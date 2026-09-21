import type { ReactElement } from 'react'
import type { ResolvedNode } from '../revisionView.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useTranslate } from 'val-i18n-react'
import { Field, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'

export function LlmTaskSection({
  selection,
  disabled,
  store,
}: {
  readonly selection: Extract<ResolvedNode, { readonly kind: 'task' }>
  readonly disabled: boolean
  readonly store: WorkspaceStore
}): ReactElement | null {
  const t = useTranslate()
  const task = selection.definition
  if (task == null || !('executor' in task) || task.executor.kind != 'llm') return null
  const llm = task.executor
  const fieldIdPrefix = `task-${selection.id}`
  return (
    <Field className="inspector-field-section" data-inspector-section="task">
      <FieldLabel className="inspector-section-title">{t('inspector.task.definition')}</FieldLabel>
      <div className="node-settings">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${fieldIdPrefix}-response-mode`}>{t('inspector.task.responseMode')}</FieldLabel>
            <NativeSelect
              disabled={disabled}
              id={`${fieldIdPrefix}-response-mode`}
              onChange={(event) => {
                const mode = event.target.value
                if ((mode == 'chat' || mode == 'json') && mode != llm.mode) {
                  void store.saveTaskSettings(selection.id, { kind: 'llm', mode, name: task.name })
                }
              }}
              value={llm.mode}
            >
              <NativeSelectOption value="chat">{t('inspector.task.chatText')}</NativeSelectOption>
              <NativeSelectOption value="json">{t('inspector.task.structuredJson')}</NativeSelectOption>
            </NativeSelect>
          </Field>
        </FieldGroup>
      </div>
    </Field>
  )
}
