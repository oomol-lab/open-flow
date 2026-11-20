import type { ComponentProps } from 'react'
import type { NodeInputField } from './nodeInputs.tsx'
import type { InputVariables, NodeInputUpstreamSources } from './sourceValueEditor.tsx'

import { useId } from 'react'
import { useTranslate } from 'val-i18n-react'
import { FieldTable } from '../../../../form/browser/fieldTable.tsx'
import { httpHeaderNameIssue } from '../../../../http/common/headers.ts'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { NodeInputValue } from './nodeInputValue.tsx'

const headerSchema = { type: 'object', additionalProperties: { type: 'string' } } as const
const expanded = () => true

/** Fixed response inputs compose the ordinary source editor and object field layout. */
export function WebhookResponseEditor({
  bodyFormat,
  onBodyFormat,
  entries,
  disabled,
  readOnly,
  variables,
  renderSource,
  onValue,
  onVariable,
}: {
  readonly bodyFormat?: 'artifact'
  readonly onBodyFormat?: (bodyFormat: 'artifact' | undefined) => void
  readonly entries: readonly NodeInputField[]
  readonly disabled: boolean
  readonly readOnly?: boolean
  readonly variables: InputVariables
  readonly renderSource?: (handle: string) => NodeInputUpstreamSources | undefined
  readonly onValue: (handle: string, value: Parameters<ComponentProps<typeof NodeInputValue>['onValue']>[0]) => void
  readonly onVariable: (handle: string, name: string | undefined) => void
}) {
  const t = useTranslate()
  const id = useId()
  const labels: Readonly<Record<string, string>> = {
    body: t('webhookEditor.webhookResponseContent'),
    statusCode: t('webhookEditor.webhookStatus'),
    headers: t('webhookEditor.webhookHeaders'),
  }
  return (
    <InspectorSection title={t('webhookEditor.webhookResponse')} className="inspector-form" data-inspector-section="inputs">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-format`}>{t('webhookEditor.responseBodyFormat')}</FieldLabel>
          <NativeSelect
            id={`${id}-format`}
            className="w-full"
            value={bodyFormat ?? 'data'}
            disabled={disabled || readOnly || onBodyFormat == null}
            onChange={(event) => onBodyFormat?.(event.target.value === 'artifact' ? 'artifact' : undefined)}
          >
            <NativeSelectOption value="data">{t('webhookEditor.responseBodyData')}</NativeSelectOption>
            <NativeSelectOption value="artifact">{t('webhookEditor.responseBodyFile')}</NativeSelectOption>
          </NativeSelect>
          {bodyFormat === 'artifact' && <FieldDescription>{t('webhookEditor.responseBodyFileHint')}</FieldDescription>}
        </Field>
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
                        httpHeaderNameIssue(
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
