import type { InputValues } from '../../../../flow/common/change.ts'
import type { Group, InputPort } from '../api.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useTranslate } from 'val-i18n-react'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { triggerConfigValues } from '../../../../trigger/common/config.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../ui/browser/select.tsx'
import { TriggerConfigEditor } from './triggerConfigEditor.tsx'
import { useTriggerConfigOptions } from './useTriggerConfigOptions.ts'

export function TallyTriggerConfig({
  inputs,
  fieldLabels,
  config,
  nodeId,
  connectionId,
  disabled,
  store,
}: {
  readonly inputs: readonly (InputPort | Group)[]
  readonly fieldLabels?: Readonly<Record<string, string>>
  readonly config: InputValues
  readonly nodeId: string
  readonly connectionId?: string
  readonly disabled: boolean
  readonly store: WorkspaceStore
}) {
  const t = useTranslate()
  const values = triggerConfigValues(inputs, config)
  const formId = typeof values.formId == 'string' ? values.formId : undefined
  const forms = useTriggerConfigOptions(store, nodeId, 'formId', JSON.stringify([store.$.flowId.value, connectionId]), connectionId != null)
  const missing = formId != null && forms.options != null && !forms.options.some((item) => item.value == formId)
  const items = [
    ...(forms.options ?? []),
    ...(formId != null && !forms.options?.some((item) => item.value == formId) ? [{ value: formId, label: formId }] : []),
  ]
  return (
    <TriggerConfigEditor
      inputs={inputs}
      fieldLabels={fieldLabels}
      config={config}
      disabled={disabled}
      onChange={(name, value) => void store.nodes.saveTriggerConfig(nodeId, name, value)}
      onReset={() => store.nodes.resetTriggerConfig(nodeId)}
      onResetValue={(name) => void store.nodes.resetTriggerConfig(nodeId, [name])}
      renderEditor={(input) =>
        input.handle == 'formId' ? (
          <div className="min-w-0">
            <Select
              items={items}
              value={formId ?? null}
              disabled={disabled || connectionId == null}
              onOpenChange={(open) => {
                if (open) forms.refresh()
              }}
              onValueChange={(value) => {
                if (typeof value == 'string') void store.nodes.saveTriggerConfig(nodeId, 'formId', value)
              }}
            >
              <SelectTrigger
                aria-label={t('tallyTrigger.form')}
                aria-invalid={missing || undefined}
                className="w-full"
                data-field-control
                data-field-prompt={missing || undefined}
                size="field"
              >
                <SelectValue placeholder={t('tallyTrigger.selectForm')} />
              </SelectTrigger>
              <SelectContent className={selectionMenuContentClass}>
                {forms.loading && <span className={`block px-2 text-muted-foreground ${selectionMenuItemClass}`}>{t('tallyTrigger.loading')}</span>}
                {forms.options?.map((item) => (
                  <SelectItem key={item.value} value={item.value} className={selectionMenuItemClass}>
                    {item.label}
                  </SelectItem>
                ))}
                {missing && formId != null && (
                  <SelectItem disabled value={formId} className={selectionMenuItemClass}>
                    {formId}
                  </SelectItem>
                )}
                {!forms.loading && !forms.failed && forms.options?.length == 0 && (
                  <span className={`block px-2 text-muted-foreground ${selectionMenuItemClass}`}>{t('tallyTrigger.noForms')}</span>
                )}
              </SelectContent>
            </Select>
            {missing && (
              <p role="status" className="text-destructive">
                {t('tallyTrigger.unavailable')}
              </p>
            )}
            {forms.failed && (
              <div role="status" className="text-destructive">
                {t('tallyTrigger.failed')}
                <Button disabled={disabled} size="field" variant="ghost" onClick={forms.refresh}>
                  {t('tallyTrigger.retry')}
                </Button>
              </div>
            )}
          </div>
        ) : undefined
      }
    />
  )
}
