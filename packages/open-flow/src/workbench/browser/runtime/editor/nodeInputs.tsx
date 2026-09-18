import type { ComponentProps, ReactNode } from 'react'
import type { Group, InputPort, JsonValue } from '../api.ts'
import type { InputVariables, NodeInputUpstreamSources } from './nodeInputValue.tsx'

import { NodeInputValue } from './nodeInputValue.tsx'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'

export type NodeInputField = Omit<ComponentProps<typeof NodeInputValue>, 'disabled' | 'variables' | 'onValue' | 'onVariable' | 'handleNames'>

export function NodeInputs({
  allowAddGroup = true,
  entries,
  variables,
  disabled,
  onValue,
  onVariable,
  onDefinitions,
  reservedNames,
  renderSource,
  title,
}: {
  allowAddGroup?: boolean
  onDefinitions?: (values: readonly (InputPort | Group)[]) => void
  reservedNames?: readonly string[]
  renderSource?: (handle: string) => NodeInputUpstreamSources | undefined
  title?: ReactNode
  entries: readonly (Group | NodeInputField)[]
  variables: InputVariables
  disabled: boolean
  onValue: (handle: string, value: JsonValue | undefined) => void
  onVariable: (handle: string, name: string | undefined) => void
}) {
  const handleNames = entries.flatMap((entry) => ('group' in entry ? [] : [entry.definition.handle]))
  return (
    <PortDefinitionEditor
      groups
      layout="ports"
      title={title}
      titleIcon={title == null ? undefined : 'input'}
      allowAddGroup={allowAddGroup}
      values={entries.map((entry) => ('group' in entry ? entry : entry.definition))}
      disabled={disabled || onDefinitions == null}
      reservedNames={reservedNames}
      onChange={(values) => onDefinitions?.(values)}
      renderValue={(port, presentation) => {
        const entry = entries.find((candidate): candidate is NodeInputField => !('group' in candidate) && candidate.definition.handle === port.handle)
        if (entry == null) return null
        return (
          <>
            <NodeInputValue
              key={port.handle}
              {...entry}
              embedded
              presentation={presentation}
              upstream={renderSource?.(port.handle)}
              handleNames={handleNames}
              variables={variables}
              disabled={disabled}
              onValue={(value) => onValue(port.handle, value)}
              onVariable={(name) => onVariable(port.handle, name)}
            />
          </>
        )
      }}
    />
  )
}
