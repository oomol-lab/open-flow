import type { ComponentProps } from 'react'
import type { NodeInputField } from './nodeInputs.tsx'
import type { InputVariables, NodeInputUpstreamSources } from './sourceValueEditor.tsx'

import { useTranslate } from 'val-i18n-react'
import { webhookHeaderNameIssue } from '../../../../flow/common/webhookResponse.ts'
import { FieldTable } from '../../../../form/browser/fieldTable.tsx'
import { Field, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { NodeInputValue } from './nodeInputValue.tsx'

const headerSchema = { type: 'object', additionalProperties: { type: 'string' } } as const
const expanded = () => true

/** Fixed response inputs compose the ordinary source editor and object field layout. */
export function WebhookResponseEditor({
  entries,
  disabled,
  readOnly,
  variables,
  renderSource,
  onValue,
  onVariable,
}: {
  readonly entries: readonly NodeInputField[]
  readonly disabled: boolean
  readonly readOnly?: boolean
  readonly variables: InputVariables
  readonly renderSource?: (handle: string) => NodeInputUpstreamSources | undefined
  readonly onValue: (handle: string, value: Parameters<ComponentProps<typeof NodeInputValue>['onValue']>[0]) => void
  readonly onVariable: (handle: string, name: string | undefined) => void
}) {
  const t = useTranslate()
  const labels: Readonly<Record<string, string>> = {
    body: t('webhookEditor.webhookResponseContent'),
    statusCode: t('webhookEditor.webhookStatus'),
    headers: t('webhookEditor.webhookHeaders'),
  }
  return (
    <InspectorSection title={t('webhookEditor.webhookResponse')} className="inspector-form" data-inspector-section="inputs">
      <FieldGroup>
        {entries.map((entry) => {
          const { definition, value } = entry
          const label = labels[definition.handle] ?? definition.handle
          const headers = definition.handle === 'headers'
          const editor = (
            <NodeInputValue
              {...entry}
              embedded
              definition={headers ? { ...definition, jsonSchema: headerSchema } : definition}
              label={label}
              variables={variables}
              disabled={disabled}
              readOnly={readOnly}
              upstream={renderSource?.(definition.handle)}
              onValue={(next) => onValue(definition.handle, next)}
              onVariable={(next) => onVariable(definition.handle, next)}
              presentation={
                headers
                  ? {
                      valueOnly: true,
                      hideOptions: true,
                      hideValueTools: true,
                      hideChildTypes: true,
                      expansionPolicy: expanded,
                      validateObjectFieldName: (next, current) =>
                        webhookHeaderNameIssue(
                          next,
                          Object.keys(value != null && typeof value === 'object' && !Array.isArray(value) ? value : {}).filter((key) => key !== current),
                        ) == null,
                    }
                  : { hideOptions: true }
              }
            />
          )
          return (
            <Field key={definition.handle}>
              <FieldLabel>{label}</FieldLabel>
              {headers ? (
                <FieldTable standalone layout="values" typeColumn={false} columnHeadings={false} actionSlots={2}>
                  {editor}
                </FieldTable>
              ) : (
                editor
              )}
            </Field>
          )
        })}
      </FieldGroup>
    </InspectorSection>
  )
}
