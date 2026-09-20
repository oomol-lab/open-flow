import type { ComponentProps, ReactNode } from 'react'
import type { FieldValueDeletion } from '../../../../form/common/fieldValue.ts'
import type { Group, InputPort, JsonValue } from '../api.ts'
import type { FieldSectionIcon } from './fieldSectionHeader.tsx'
import type { PropertyDeletion } from './propertyDeletion.ts'
import type { InputVariables, NodeInputUpstreamSources } from './sourceValueEditor.tsx'

import { useState } from 'react'
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
  onReset,
  reservedNames,
  renderSource,
  title,
  titleIcon = 'input',
}: {
  onReset?: () => void | Promise<boolean>
  allowAddGroup?: boolean
  onDefinitions?: (definitions: readonly (InputPort | Group)[], deletion?: PropertyDeletion, values?: Readonly<Record<string, JsonValue | undefined>>) => void
  reservedNames?: readonly string[]
  renderSource?: (handle: string) => NodeInputUpstreamSources | undefined
  title?: ReactNode
  titleIcon?: FieldSectionIcon
  entries: readonly (Group | NodeInputField)[]
  variables: InputVariables
  disabled: boolean
  onValue: (handle: string, value: JsonValue | undefined, deletion?: FieldValueDeletion) => void
  onVariable: (handle: string, name: string | undefined) => void
}) {
  const [resetVersion, setResetVersion] = useState(0)
  const handleNames = entries.flatMap((entry) => ('group' in entry ? [] : [entry.definition.handle]))
  return (
    <PortDefinitionEditor
      key={resetVersion}
      groups
      onReset={
        !disabled && onDefinitions == null && onReset
          ? async () => {
              if ((await onReset()) !== false) setResetVersion((version) => version + 1)
            }
          : undefined
      }
      layout="ports"
      title={title}
      titleIcon={titleIcon}
      allowAddGroup={allowAddGroup}
      values={entries.map((entry) => ('group' in entry ? entry : entry.definition))}
      disabled={disabled || onDefinitions == null}
      reservedNames={reservedNames}
      onChange={(values, deletion) => onDefinitions?.(values, deletion)}
      renderValue={(port, presentation) => {
        const entry = entries.find((candidate): candidate is NodeInputField => !('group' in candidate) && candidate.definition.handle === port.handle)
        if (entry == null) return null
        return (
          <>
            <NodeInputValue
              key={port.handle}
              {...entry}
              embedded
              presentation={{
                ...presentation,
                onDefinitionChange:
                  presentation.onDefinitionChange && onDefinitions
                    ? (schema, value, deletion) =>
                        onDefinitions(
                          entries.map((item) =>
                            'group' in item
                              ? item
                              : item.definition.handle === port.handle
                                ? { ...item.definition, jsonSchema: schema as InputPort['jsonSchema'] }
                                : item.definition,
                          ),
                          deletion,
                          { [port.handle]: value as JsonValue | undefined },
                        )
                    : undefined,
              }}
              upstream={renderSource?.(port.handle)}
              handleNames={handleNames}
              variables={variables}
              disabled={disabled}
              onValue={(value, deletion) => onValue(port.handle, value, deletion)}
              onVariable={(name) => onVariable(port.handle, name)}
            />
          </>
        )
      }}
    />
  )
}
