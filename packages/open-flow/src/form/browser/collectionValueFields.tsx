import styles from './valueEditor.module.scss'
import type { FieldValueDeletion } from '../common/fieldValue.ts'
import type { ValueType } from '../common/value.ts'
import type { FieldValueEditorProps } from './fieldValueEditor.tsx'

import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Input } from '../../ui/browser/input.tsx'
import { valueForEditor } from '../common/editorComponent.ts'
import { fieldValueState, setArrayItem } from '../common/fieldValue.ts'
import { objectFieldNames, renameFieldDefinition, removeFieldDefinition } from '../common/objectFields.ts'
import { initialValue, jsonDataTypes, objectValue, renameObjectField, setObjectField, valueType } from '../common/value.ts'
import { ArrayFieldList } from './arrayFieldList.tsx'
import { collectionCreateAction, objectFieldAdder } from './collectionActions.ts'
import { editorComponentIcons } from './editorComponentIcon.tsx'
import { EditorComponentSelect } from './editorComponentSelect.tsx'
import { FieldName } from './fieldName.tsx'
import { FieldSelect } from './fieldSelect.tsx'
import { FieldValueEditor } from './fieldValueEditor.tsx'
import { PropertyName } from './propertyName.tsx'
import { SortableFieldList } from './sortableFieldList.tsx'
type CollectionProps = FieldValueEditorProps & { empty?: boolean }
function childFields(props: FieldValueEditorProps) {
  const { label, disabled, path, onDraftIssue, depth = 0, valueEditable } = props
  const child = (
    key: string | number,
    childSchema: unknown,
    childValue: unknown,
    change: (value: unknown, deletion?: FieldValueDeletion) => void,
    presentation: Pick<
      FieldValueEditorProps,
      | 'header'
      | 'actions'
      | 'hideOptions'
      | 'arrayChild'
      | 'objectChild'
      | 'layout'
      | 'onDefinitionChange'
      | 'leadingControl'
      | 'disclosureContent'
      | 'typeWidth'
    >,
  ) => (
    <FieldValueEditor
      layout={props.layout}
      expansionPolicy={props.expansionPolicy}
      schema={childSchema}
      value={childValue}
      onChange={change}
      valueEditable={valueEditable}
      disabled={disabled}
      label={`${label}.${key}`}
      path={`${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`}
      onDraftIssue={onDraftIssue}
      depth={depth + 1}
      {...presentation}
      description={typeof objectValue(childSchema)?.description === 'string' ? String(objectValue(childSchema)!.description) : undefined}
    />
  )
  return child
}
export function ObjectValueFields(props: CollectionProps) {
  const { schema, value, onChange, label } = props
  const disabled = props.disabled || props.valueEditable === false
  const source = objectValue(schema) ?? {}
  const t = useTranslate()
  const child = childFields(props)
  const canAddObjectField = props.onDefinitionChange != null || source.additionalProperties !== false
  const showAddObjectField = canAddObjectField && !disabled
  const object = objectValue(value)
  const properties = objectValue(source.properties) ?? {}
  const names = objectFieldNames(schema, value)
  const addObjectField = objectFieldAdder(props)
  const emptyObjectControl = (
    <Button
      type="button"
      variant="ghost"
      size="field"
      className={`${styles.emptyObjectContent} ${canAddObjectField ? '' : styles.emptyObjectConstraint}`}
      disabled={!showAddObjectField}
      aria-label={`${t(showAddObjectField ? 'valueEditor.addField' : disabled ? 'valueEditor.emptyObjectValue' : 'valueEditor.closedObjectDefinition')} ${label}`}
      onClick={() => addObjectField()}
    >
      {showAddObjectField && <i aria-hidden="true" className="i-lucide-light:plus" />}
      {t(showAddObjectField ? 'valueEditor.addField' : disabled ? 'valueEditor.emptyObjectValue' : 'valueEditor.closedObjectDefinition')}
    </Button>
  )
  if (disabled && value == null) {
    const { display } = fieldValueState(schema, value, props.nullable)
    return (
      <div className={styles.collection}>
        <div className={styles.collectionActions} data-layout="values">
          <div className={`${styles.emptyObjectContent} ${styles.objectNotice}`}>{display === 'null' ? 'null' : t('valueEditor.unset')}</div>
        </div>
      </div>
    )
  }
  return (
    <div className={styles.collection}>
      <SortableFieldList
        names={props.empty ? [] : names}
        onReorder={!disabled && props.onDefinitionChange ? (order) => props.onDefinitionChange!({ ...source, 'ui:order': order }, value) : undefined}
      >
        {(name, handle) => {
          const fieldSchema = Object.hasOwn(properties, name) ? properties[name] : (source.additionalProperties ?? {})
          const fieldSource = objectValue(fieldSchema) ?? {}
          const fieldValue = object && Object.hasOwn(object, name) ? object[name] : undefined
          return (
            <div data-object-field-content>
              {child(name, fieldSchema, fieldValue, (next, deletion) => onChange(setObjectField(value, name, next), deletion), {
                onDefinitionChange: props.onDefinitionChange
                  ? (nextSchema, nextValue, deletion) =>
                      props.onDefinitionChange!(
                        { ...source, properties: { ...properties, [name]: nextSchema } },
                        setObjectField(value, name, nextValue),
                        deletion,
                      )
                  : undefined,
                leadingControl: handle,
                objectChild: true,
                layout: 'values',
                typeWidth:
                  !disabled &&
                  (props.onDefinitionChange || !(typeof fieldSource.type === 'string' || fieldSource.enum != null || fieldSource.const !== undefined))
                    ? 'editable'
                    : 'fixed',
                hideOptions: true,
                header: (
                  <>
                    <FieldName name={name} description={typeof fieldSource.description === 'string' ? fieldSource.description : undefined}>
                      {Object.hasOwn(properties, name) && !props.onDefinitionChange ? (
                        <Input aria-label={t('valueEditor.fieldName')} value={name} readOnly />
                      ) : (
                        <PropertyName
                          name={name}
                          disabled={disabled}
                          onRename={(nextName) => {
                            if (props.onDefinitionChange) {
                              const nextSchema = renameFieldDefinition(schema, name, nextName)
                              if (!nextSchema) return false
                              const next = object && Object.hasOwn(object, name) ? renameObjectField(value, name, nextName) : value
                              props.onDefinitionChange(nextSchema, next)
                            } else {
                              const next = renameObjectField(value, name, nextName)
                              if (!next) return false
                              onChange(next)
                            }
                            return true
                          }}
                        />
                      )}
                    </FieldName>
                    <div data-field-type>
                      {props.onDefinitionChange ? (
                        <EditorComponentSelect
                          schema={fieldSchema}
                          name={`${label}.${name}`}
                          readOnly={disabled}
                          onChange={(nextSchema) =>
                            props.onDefinitionChange!(
                              { ...source, properties: { ...properties, [name]: nextSchema } },
                              setObjectField(value, name, valueForEditor(nextSchema, fieldValue)),
                            )
                          }
                        />
                      ) : typeof fieldSource.type === 'string' || fieldSource.enum != null || fieldSource.const !== undefined ? (
                        <EditorComponentSelect schema={fieldSchema} name={`${label}.${name}`} readOnly onChange={() => {}} />
                      ) : (
                        <FieldSelect
                          icons={editorComponentIcons}
                          aria-label={t('valueEditor.type', { name: `${label}.${name}` })}
                          value={valueType(fieldSchema, fieldValue)}
                          readOnly={disabled}
                          onChange={(next) => {
                            onChange(setObjectField(value, name, initialValue(fieldSchema, next as ValueType)))
                          }}
                        >
                          {[...jsonDataTypes, 'integer' as const]
                            .filter((candidate) => !Array.isArray(fieldSource.type) || (fieldSource.type as unknown[]).includes(candidate))
                            .map((candidate) => (
                              <option key={candidate} value={candidate}>
                                {candidate}
                              </option>
                            ))}
                        </FieldSelect>
                      )}
                    </div>
                  </>
                ),
                actions: (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${t('valueEditor.addField')} ${label}.${name}`}
                      disabled={disabled || !canAddObjectField}
                      onClick={() => addObjectField(name)}
                    >
                      <i aria-hidden="true" className="i-tabler-light:square-rounded-plus text-lg" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${t(Object.hasOwn(properties, name) && !props.onDefinitionChange ? 'valueEditor.clear' : 'valueEditor.remove')} ${name}`}
                      disabled={
                        disabled ||
                        (!props.onDefinitionChange && (fieldValue === undefined || (Array.isArray(source.required) && source.required.includes(name))))
                      }
                      onClick={() => {
                        const next = setObjectField(value, name, undefined)
                        if (props.onDefinitionChange)
                          props.onDefinitionChange(removeFieldDefinition(schema, name), next, { target: 'objectItem', name: `${label}.${name}` })
                        else onChange(next, { target: 'objectItem', name: `${label}.${name}` })
                      }}
                    >
                      <i aria-hidden="true" className="i-tabler-light:square-rounded-minus text-lg" />
                    </Button>
                  </>
                ),
              })}
            </div>
          )
        }}
      </SortableFieldList>
      <div className={styles.collectionActions} data-layout="values">
        {!props.empty && names.length === 0 && emptyObjectControl}
      </div>
    </div>
  )
}
export function ArrayValueFields(props: CollectionProps) {
  const { schema, value, onChange, label, disabled, valueEditable = true } = props
  const source = objectValue(schema) ?? {}
  const t = useTranslate()
  const child = childFields(props)
  const array = Array.isArray(value) ? value : []
  const create = collectionCreateAction(props)
  const emptyArrayControl = (
    <Button
      type="button"
      variant="ghost"
      size="field"
      className={styles.emptyObjectContent}
      aria-label={`${t('valueEditor.addItem')} ${label}`}
      disabled={!create}
      onClick={create}
    >
      <i aria-hidden="true" className="i-lucide-light:plus" />
      {t('valueEditor.addItem')}
    </Button>
  )
  return (
    <div className={styles.collection}>
      <ArrayFieldList values={array} onReorder={!disabled && valueEditable ? onChange : undefined} label={label}>
        {(item, index, handle) => {
          const itemSchema = Array.isArray(source.items) ? (source.items[index] ?? source.additionalItems ?? {}) : (source.items ?? {})
          return (
            <div data-array-field-content>
              {child(index, itemSchema, item, (next, deletion) => onChange(setArrayItem(array, index, next), deletion), {
                arrayChild: true,
                header: <></>,
                disclosureContent: <span className={styles.arrayIndex}>{index}.</span>,
                leadingControl: handle || undefined,
                onDefinitionChange:
                  props.onDefinitionChange && !Array.isArray(source.items)
                    ? (items, nextValue, deletion) =>
                        props.onDefinitionChange!(
                          { ...source, items },
                          array.map((entry, at) => (at === index ? nextValue : entry)),
                          deletion,
                        )
                    : undefined,
                hideOptions: true,
                actions: (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${t('valueEditor.addItem')} ${label}.${index}`}
                      disabled={disabled || (typeof source.maxItems === 'number' && array.length >= source.maxItems)}
                      onClick={() =>
                        onChange(
                          array.toSpliced(
                            index + 1,
                            0,
                            initialValue(Array.isArray(source.items) ? (source.items[index + 1] ?? source.additionalItems ?? {}) : (source.items ?? {})),
                          ),
                        )
                      }
                    >
                      <i aria-hidden="true" className="i-tabler-light:square-rounded-plus text-lg" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${t('valueEditor.remove')} ${label}.${index}`}
                      disabled={disabled || (typeof source.minItems === 'number' && array.length <= source.minItems)}
                      onClick={() => onChange(array.toSpliced(index, 1), { target: 'arrayItem', name: `${label}.${index}` })}
                    >
                      <i aria-hidden="true" className="i-tabler-light:square-rounded-minus text-lg" />
                    </Button>
                  </>
                ),
              })}
            </div>
          )
        }}
      </ArrayFieldList>
      {array.length === 0 && (
        <div className={styles.collectionActions} data-layout="values">
          {emptyArrayControl}
        </div>
      )}
    </div>
  )
}
