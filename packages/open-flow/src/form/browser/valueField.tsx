import type { ValueEditorProps } from './valueEditor.tsx'

import { useTranslate } from 'val-i18n-react'
import { Input } from '../../ui/browser/input.tsx'
import { editorComponent } from '../common/editorComponent.ts'
import { EditorComponentIcon } from './editorComponentIcon.tsx'
import { FieldNullable } from './fieldTable.tsx'
import { FieldTypeDisplay } from './fieldTypeDisplay.tsx'
import { ValueEditor } from './valueEditor.tsx'

/** A schema-defined field edits values only; its name, type and nullability stay fixed. */
export function ValueField(props: Omit<ValueEditorProps, 'header' | 'layout' | 'trailingControl' | 'onDefinitionChange'>) {
  const t = useTranslate()
  const component = editorComponent(props.schema)
  const type = t(`valueEditor.components.${component}`)
  return (
    <ValueEditor
      {...props}
      layout="ports"
      header={
        <>
          <span data-field-name>
            <Input aria-label={t('valueEditor.fieldName')} value={props.label} readOnly />
          </span>
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
