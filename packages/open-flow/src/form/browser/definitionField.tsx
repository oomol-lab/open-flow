import styles from './valueEditor.module.scss'
import type { ReactNode } from 'react'
import type { FieldExpansionPolicy } from '../common/fieldExpansion.ts'
import type { FieldValueDeletion } from '../common/fieldValue.ts'
import type { FieldRowPresentation } from './fieldLayout.tsx'

import { useContext, useId } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Input } from '../../ui/browser/input.tsx'
import { definitionFieldExpansion } from '../common/fieldExpansion.ts'
import { objectFieldNames, renameFieldDefinition, removeFieldDefinition } from '../common/objectFields.ts'
import { objectValue } from '../common/value.ts'
import { EditorComponentSelect } from './editorComponentSelect.tsx'
import { FieldRow, FieldBranch } from './fieldLayout.tsx'
import { FieldName } from './fieldName.tsx'
import { FieldSorting } from './fieldSorting.ts'
import { PropertyName } from './propertyName.tsx'
import { SortableFieldList } from './sortableFieldList.tsx'
import { useFieldExpansion } from './useFieldExpansion.ts'

export interface DefinitionFieldProps extends FieldRowPresentation {
  expansionPolicy?: FieldExpansionPolicy
  schema: unknown
  label: string
  disabled?: boolean
  options?: ReactNode
  onChange?: (schema: unknown, deletion?: FieldValueDeletion) => void
}
/** Schema structure only: no runtime value, value validation, defaults, or clearing. */
export function DefinitionField({
  schema,
  label,
  disabled,
  onChange,
  options,
  depth = 0,
  expansionPolicy = definitionFieldExpansion,
  ...row
}: DefinitionFieldProps) {
  const t = useTranslate()
  const sorting = useContext(FieldSorting)
  const id = useId()
  const source = objectValue(schema) ?? {}
  const properties = objectValue(source.properties) ?? {}
  const names = objectFieldNames(schema)
  const additional = source.additionalProperties
  const patterned = Object.keys(objectValue(source.patternProperties) ?? {}).length > 0
  const editable = !disabled && onChange != null
  const expandable = source.type === 'object'
  const { expanded, bodyMounted, setExpanded } = useFieldExpansion({ depth, expandable, editable: false, empty: false, validation: 'valid' }, expansionPolicy)
  const add = (after?: string) => {
    let name = 'field'
    let suffix = 1
    while (names.includes(name)) name = `field${suffix++}`
    const order = [...names]
    order.splice(after == null ? order.length : order.indexOf(after) + 1, 0, name)
    onChange?.({ ...source, 'properties': { ...properties, [name]: { type: 'string' } }, 'ui:order': order })
  }
  return (
    <FieldRow
      {...row}
      depth={depth}
      label={label}
      sorting={sorting}
      role="group"
      aria-label={label}
      data-output
      data-object-child={depth > 0 || undefined}
      data-collection={expandable || undefined}
      data-structured={expandable || undefined}
      data-expanded={expanded || undefined}
      disclosure={expandable ? { controls: id, expanded, onToggle: () => setExpanded(!expanded) } : undefined}
      actions={row.actions ?? options}
    >
      {expandable && bodyMounted && (
        <FieldBranch
          id={id}
          className={styles.body}
          endpoint={names.length && (sorting || objectValue(properties[names[0]!])?.type === 'object') ? 'marker' : 'control'}
          hidden={!expanded}
        >
          <div className={styles.collection}>
            <SortableFieldList names={names} onReorder={editable ? (order) => onChange({ ...source, 'ui:order': order }) : undefined}>
              {(name, handle) => (
                <div data-object-field-content>
                  <DefinitionField
                    schema={properties[name]}
                    expansionPolicy={expansionPolicy}
                    label={`${label}.${name}`}
                    layout="values"
                    depth={depth + 1}
                    disabled={!editable}
                    leadingControl={handle}
                    header={(disclosure) => (
                      <>
                        <FieldName
                          name={name}
                          description={
                            typeof objectValue(properties[name])?.description === 'string' ? String(objectValue(properties[name])!.description) : undefined
                          }
                        >
                          {editable ? (
                            <PropertyName
                              name={name}
                              onRename={(next) => {
                                const nextSchema = renameFieldDefinition(schema, name, next)
                                if (!nextSchema) return false
                                onChange(nextSchema)
                                return true
                              }}
                            />
                          ) : (
                            <Input aria-label={t('valueEditor.fieldName')} value={name} readOnly />
                          )}
                        </FieldName>
                        <span data-field-type>
                          <EditorComponentSelect
                            schema={properties[name]}
                            name={`${label}.${name}`}
                            readOnly={!editable}
                            readOnlySurface
                            compact={false}
                            showArrayItemType
                            disclosure={!editable ? disclosure : undefined}
                            onChange={(next) => onChange?.({ ...source, properties: { ...properties, [name]: next } })}
                          />
                        </span>
                      </>
                    )}
                    onChange={editable ? (next, deletion) => onChange({ ...source, properties: { ...properties, [name]: next } }, deletion) : undefined}
                    actions={
                      editable ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`${t('valueEditor.addField')} ${label}.${name}`}
                            onClick={() => add(name)}
                          >
                            <i aria-hidden="true" className="i-tabler-light:square-rounded-plus text-lg" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`${t('valueEditor.remove')} ${name}`}
                            onClick={() => onChange(removeFieldDefinition(schema, name), { target: 'objectItem', name: `${label}.${name}` })}
                          >
                            <i aria-hidden="true" className="i-tabler-light:square-rounded-minus text-lg" />
                          </Button>
                        </>
                      ) : (
                        <span aria-hidden="true" className="flex h-6 shrink-0 gap-0.5" data-readonly-object-action-slots>
                          <span className="size-6" />
                          <span className="size-6" />
                        </span>
                      )
                    }
                  />
                </div>
              )}
            </SortableFieldList>
            {!names.length && (
              <div className={styles.collectionActions} data-layout="values">
                {editable ? (
                  <Button type="button" variant="ghost" size="field" className={styles.emptyObjectContent} onClick={() => add()}>
                    {t('valueEditor.addField')}
                  </Button>
                ) : (
                  <div className={`${styles.emptyObjectContent} ${styles.objectNotice}`}>
                    <span>
                      {t(
                        patterned
                          ? 'valueEditor.schemaDefinedFields'
                          : additional === false
                            ? 'valueEditor.closedObjectDefinition'
                            : 'valueEditor.unrestrictedFields',
                      )}
                    </span>
                    {objectValue(additional) && (
                      <div className="flex min-w-0 items-center gap-1">
                        <span>{t('valueEditor.additionalFieldValues')}</span>
                        <EditorComponentSelect schema={additional} name={label} readOnly compact={false} onChange={() => {}} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </FieldBranch>
      )}
    </FieldRow>
  )
}
