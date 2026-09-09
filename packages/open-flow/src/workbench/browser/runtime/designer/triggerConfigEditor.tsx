import type { JsonValue } from '../api.ts'

import { useTranslate } from 'val-i18n-react'
import { EnumChoices } from '../../../../form/browser/choiceEditor.tsx'
import { ValueEditor } from '../../../../form/browser/valueEditor.tsx'
import { isJsonValue, objectValue } from '../../../../form/common/value.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'

// Invalid text stays inside the field editor; there is no separate submit action.
const draftIssue = () => {}

export function TriggerConfigEditor({
  schema,
  config,
  disabled,
  onChange,
}: {
  readonly schema: JsonValue
  readonly config: Readonly<Record<string, JsonValue>>
  readonly disabled: boolean
  readonly onChange: (name: string, value: JsonValue | undefined) => void
}) {
  const t = useTranslate()
  const source = objectValue(schema)
  const required = Array.isArray(source?.required) ? source.required : []
  const properties = Object.entries(objectValue(source?.properties) ?? {})
    .filter(([, candidate]) => objectValue(candidate) != null)
    .toSorted(([left], [right]) => Number(!required.includes(left)) - Number(!required.includes(right)))
  if (properties.length === 0) return null
  return (
    <section className="inspector-section" data-inspector-section="trigger">
      <h3>{t('triggerConfig.configuration')}</h3>
      <FieldGroup>
        {properties.map(([name, candidate]) => {
          const field = objectValue(candidate)!
          const label = typeof field.title === 'string' ? field.title : name
          const missing = required.includes(name) && !Object.hasOwn(config, name)
          const value = Object.hasOwn(config, name) ? config[name] : field.default
          const items = objectValue(field.items)
          const change = (next: unknown) => {
            if (next === undefined || isJsonValue(next)) onChange(name, next as JsonValue | undefined)
          }
          return (
            <Field key={name} data-invalid={missing || undefined}>
              <FieldLabel>
                {label}
                {required.includes(name) ? ' *' : ''}
              </FieldLabel>
              {typeof field.description === 'string' && <FieldDescription>{field.description}</FieldDescription>}
              {field.type === 'array' && Array.isArray(items?.enum) ? (
                <>
                  {value !== undefined && (
                    <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => change(undefined)}>
                      {t('valueEditor.clear')}
                    </Button>
                  )}
                  <EnumChoices label={label} options={items.enum} labels={undefined} value={value} disabled={disabled} onChange={change} />
                </>
              ) : (
                <ValueEditor
                  schema={candidate}
                  value={value}
                  label={label}
                  disabled={disabled}
                  path={`/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`}
                  onChange={change}
                  onDraftIssue={draftIssue}
                />
              )}
              {missing && <FieldError>{t('triggerConfig.required')}</FieldError>}
            </Field>
          )
        })}
      </FieldGroup>
    </section>
  )
}
