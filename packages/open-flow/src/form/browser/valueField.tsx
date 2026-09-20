import type { FieldValueEditorProps } from './fieldValueEditor.tsx'

import { useTranslate } from 'val-i18n-react'
import { Input } from '../../ui/browser/input.tsx'
import { editorComponent } from '../common/editorComponent.ts'
import { EditorComponentIcon } from './editorComponentIcon.tsx'
import { FieldName } from './fieldName.tsx'
import { FieldNullable } from './fieldTable.tsx'
import { FieldTypeDisplay } from './fieldTypeDisplay.tsx'
import { FieldValueEditor } from './fieldValueEditor.tsx'

/** A schema-defined field edits values only; its name, type and nullability stay fixed. */
export function ValueField(props: Omit<FieldValueEditorProps, 'header' | 'layout' | 'trailingControl' | 'onDefinitionChange'>) {
  const t = useTranslate()
  const component = editorComponent(props.schema)
  const type = t(`valueEditor.components.${component}`)
  return (
    <FieldValueEditor
      {...props}
      layout="ports"
      header={
        <>
          <FieldName name={props.label} description={props.description}>
            <Input aria-label={t('valueEditor.fieldName')} value={props.label} readOnly />
          </FieldName>
          <span data-field-type>
            <FieldTypeDisplay
              label={type}
              accessibleLabel={`${t('valueEditor.type', { name: props.label })}: ${type}`}
              icon={<EditorComponentIcon component={component} />}
            />
          </span>
        </>
      }
      trailingControl={<FieldNullable name={props.label} checked={props.nullable === true} />}
    />
  )
}
