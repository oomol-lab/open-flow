import type { DesignerOption as IBasicOption } from '../../components/select.tsx'
import type { WidgetType } from '../../jsonSchema/preset.ts'

export const typeHasSubpanel: Set<WidgetType> = /*#__PURE__*/ new Set([
  'string',
  'integer',
  'number',
  'color',
  'date',
  'select',
  'multiSelect',
  'array',
  'object',
  'anyOf',
])

export const StringFormats = ['email', 'uri'] as const

export type StringFormat = (typeof StringFormats)[number]

export interface StringFormatOption extends IBasicOption {
  value: StringFormat | ''
}

export const stringFormatOptions = (t: (key: string) => string): StringFormatOption[] => [
  { label: t('schemaEditor.stringFormat.email'), value: 'email' },
  { label: t('schemaEditor.stringFormat.uri'), value: 'uri' },
  { label: t('inputHandleEditor.unset'), value: '' },
]

export function optionOfStringFormat(format: StringFormat | undefined, t: (key: string) => string): StringFormatOption {
  const value: StringFormat | '' = format || ''
  return stringFormatOptions(t).find((option) => option.value === value)!
}
