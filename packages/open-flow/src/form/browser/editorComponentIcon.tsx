import type { EditorComponent } from '../common/editorComponent.ts'

export const editorComponentIcons = {
  string: 'i-lucide-light:type',
  text: 'i-lucide-light:text-wrap',
  number: 'i-lucide-light:hash',
  integer: 'i-lucide-light:tally-5',
  select: 'i-lucide-light:circle-dot',
  multiSelect: 'i-lucide-light:list-checks',
  boolean: 'i-lucide-light:toggle-left',
  date: 'i-lucide-light:calendar-days',
  time: 'i-lucide-light:clock',
  dateTime: 'i-lucide-light:calendar-clock',
  color: 'i-lucide-light:palette',
  object: 'i-lucide-light:braces',
  array: 'i-lucide-light:brackets',
  json: 'i-lucide-light:file-json',
  null: 'i-lucide-light:circle-dashed',
} as const satisfies Record<EditorComponent, string>

export function EditorComponentIcon({ component }: { component: EditorComponent }) {
  return <i aria-hidden="true" className={`${editorComponentIcons[component]} inline-block shrink-0 text-base`} />
}
