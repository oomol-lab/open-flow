import type { ComponentProps, ReactElement } from 'react'
import type { Group, JsonValue } from '../api.ts'
import type { InputVariables } from './nodeInputValue.tsx'

import { NodeInputValue } from './nodeInputValue.tsx'

export type NodeInputField = Omit<ComponentProps<typeof NodeInputValue>, 'disabled' | 'variables' | 'onValue' | 'onVariable' | 'handleNames'>

export function NodeInputs({
  entries,
  variables,
  disabled,
  onValue,
  onVariable,
}: {
  entries: readonly (Group | NodeInputField)[]
  variables: InputVariables
  disabled: boolean
  onValue: (handle: string, value: JsonValue | undefined) => void
  onVariable: (handle: string, name: string | undefined) => void
}) {
  const handleNames = entries.flatMap((entry) => ('group' in entry ? [] : [entry.definition.handle]))
  const sections: { group?: Group; children: ReactElement[] }[] = [{ children: [] }]
  for (const entry of entries) {
    if ('group' in entry) {
      sections.push({ group: entry, children: [] })
      continue
    }
    sections[sections.length - 1]!.children.push(
      <NodeInputValue
        key={entry.definition.handle}
        {...entry}
        handleNames={handleNames}
        variables={variables}
        disabled={disabled}
        onValue={(value) => onValue(entry.definition.handle, value)}
        onVariable={(name) => onVariable(entry.definition.handle, name)}
      />,
    )
  }
  return sections.map((section, index) =>
    section.group == null ? (
      <div key={index}>{section.children}</div>
    ) : (
      <details key={index} className="inspector-disclosure" open={section.group.collapsed !== true}>
        <summary>{section.group.group}</summary>
        {section.children}
      </details>
    ),
  )
}
