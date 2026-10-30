import type { InputPort, JsonValue, TaskDefinition } from '../api.ts'
import type { HttpParameterEdit } from './flowChanges.ts'
import type { NodeInputField } from './nodeInputs.tsx'
import type { InputVariables, NodeInputUpstreamSources } from './sourceValueEditor.tsx'

import { useTranslate } from 'val-i18n-react'
import { FieldTable } from '../../../../form/browser/fieldTable.tsx'
import { httpHeaderNameIssue } from '../../../../http/common/headers.ts'
import { httpHeaderSchema, httpQuerySchema } from '../../../../http/common/httpRequest.ts'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { NodeInputValue } from './nodeInputValue.tsx'

const expanded = () => true
const object = (value: JsonValue | undefined): Record<string, JsonValue> =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, JsonValue>) : {}
export function HttpParameterEditor({
  group,
  task,
  entries,
  disabled,
  readOnly,
  variables,
  renderSource,
  onEdit,
}: {
  group: 'query' | 'headers'
  task: Extract<TaskDefinition, { executor: unknown }>
  entries: Readonly<Record<string, Pick<NodeInputField, 'value' | 'connected' | 'variableName'>>>
  disabled: boolean
  readOnly: boolean
  variables: InputVariables
  renderSource: (handle: string, port: InputPort) => NodeInputUpstreamSources | undefined
  onEdit: (edit: HttpParameterEdit) => void
}) {
  const t = useTranslate()
  if (task.executor.kind !== 'http-request') return null
  const parameters = task.executor[group]
  const root = parameters.mode === 'object' ? entries[group] : undefined
  const label = t(`httpRequest.${group}`)
  const schema = group === 'query' ? httpQuerySchema : httpHeaderSchema
  const handle = (name: string) => `${group === 'query' ? 'query' : 'header'}.${name}`
  const values: Record<string, JsonValue> =
    parameters.mode === 'fields'
      ? Object.fromEntries(
          parameters.names.map((name) => {
            const value = entries[handle(name)]?.value
            return [name, value === undefined ? '' : value]
          }),
        )
      : object(root?.value)

  const input = (port: InputPort, entry: Pick<NodeInputField, 'value' | 'connected' | 'variableName'> | undefined, name?: string) => {
    const upstream = renderSource(port.handle, port)
    return {
      embedded: true,
      definition: port,
      variables,
      disabled,
      readOnly,
      variableName: entry?.variableName,
      connected: entry?.connected ?? false,
      upstream:
        upstream == null
          ? undefined
          : {
              ...upstream,
              onChange: (source: Parameters<NonNullable<NodeInputUpstreamSources['onChange']>>[0]) =>
                onEdit({ kind: 'source', source: { kind: 'node', ...source }, field: name, fields: values }),
            },
      onVariable: (next: string | undefined) => {
        if (next == null) onEdit({ kind: 'fields', value: name == null ? {} : { ...values, [name]: '' }, field: name })
        else onEdit({ kind: 'variable', name: next, field: name, fields: values })
      },
    }
  }
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <FieldTable standalone layout="values" typeColumn={false} columnHeadings={false} actionSlots={2}>
        <NodeInputValue
          {...input({ handle: group, jsonSchema: schema, nullable: true }, root)}
          label={label}
          value={values}
          onValue={(next) => onEdit({ kind: 'fields', value: object(next) })}
          presentation={{
            valueOnly: true,
            hideOptions: true,
            hideValueTools: true,
            hideChildTypes: true,
            expansionPolicy: expanded,
            validateObjectFieldName: (name, current) =>
              group === 'query'
                ? !!name.trim() && (name === current || !Object.hasOwn(values, name))
                : httpHeaderNameIssue(
                    name,
                    Object.keys(values).filter((key) => key !== current),
                  ) == null,
            renderObjectField: (name, props) => (
              <NodeInputValue
                {...input(
                  { handle: handle(name), jsonSchema: props.schema as JsonValue, nullable: true },
                  parameters.mode === 'fields' ? entries[handle(name)] : undefined,
                  name,
                )}
                label={props.label}
                value={parameters.mode === 'fields' ? entries[handle(name)]?.value : values[name]}
                presentation={props}
                onValue={(value) => onEdit({ kind: 'fields', value: { ...values, [name]: value ?? null }, field: name })}
              />
            ),
          }}
        />
      </FieldTable>
    </Field>
  )
}
